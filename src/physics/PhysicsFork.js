/* eslint-disable prettier/prettier */
const RAPIER = require("@dimforge/rapier3d-compat");

const MESSAGES = {
	SET_CONFIG: "setConfig",
	APPLY_INPUTS: "applyInputs",
	ADD_PLAYER: "addPlayer",
	REMOVE_PLAYER: "removePlayerProp",
};

class PhysicsRapier {
	constructor(roomConfig, updatePhysics) {
		this.roomConfig = roomConfig;
		this.updatePhysics = updatePhysics;
	}
	async init({ frequency }) {
		await RAPIER.init();
		this.loop = this.loop.bind(this);
		this.frequency = frequency;
		this.players = new Map();
		this.playersArray = [];
		this.looping = true;
		this.eventsQueue = new RAPIER.EventQueue(true);
		this.handles = new Map();
		this.lastUpdateTime = performance.now();
		this.lastTime = performance.now();
		this.playersSendData = {};
		this.maxClimbAngle = 45;
		this.vector = new RAPIER.Vector3(0, 0, 0);

		this.gravity = new RAPIER.Vector3(0.0, -20, 0.0);
		this.world = new RAPIER.World(this.gravity);
		this.world.numSolverIterations = 4;
		this.world.numAdditionalFrictionIterations = 4;
		//this.world.numInternalPgsIterations = 1
		//this.world.integrationParameters.lengthUnit = 1
		//this.world.integrationParameters.normalizedPredictionDistance = 0.002
		//this.world.integrationParameters.normalizedAllowedLinearError = 0.001
		this.environment = new Environment(this.world);
		this.setConfig(this.roomConfig);
		process.on("message", this.onMessage.bind(this));
		this.loop();
	}

	setConfig(roomConfig) {
		//this.roomConfig = roomConfig;
		//this.spawnPoints = roomConfig.map.spawnPoints;
		roomConfig.maps.forEach((map) => this.environment.addMap(map));

		this.modelsCarsInfo = roomConfig.modelsInfo.modelsCarsInfo;
		this.modelsMotoInfo = roomConfig.modelsInfo.modelsMotoInfo;
		this.spawnPoints = roomConfig.spawnPoints;

		this.wheelsSetup = roomConfig.wheelsSetup;
		this.carShape = roomConfig.carShape;
	}

	onMessage(message) {
		const { type, data } = message;
		switch (type) {
			case MESSAGES.SET_CONFIG:
				this.setConfig(data);
				break;
			case MESSAGES.APPLY_INPUTS:
				this.applyInputs(data);
				break;
			case MESSAGES.ADD_PLAYER:
				this.addPlayer(data);
				break;
			case MESSAGES.REMOVE_PLAYER:
				this.removePlayer(data.userID);
				break;
			default:
				break;
		}
	}

	addPlayer({ userID, position, rotation, ctrls, modelIndex, modelType, name }) {
		if (this.players.has(userID)) return;
		position = position || { x: 0, y: 0, z: 0 };
		rotation = rotation || { x: 0, y: 0, z: 0 };
		ctrls = ctrls || {
			forward: 0,
			back: 0,
			left: 0,
			right: 0,
			reset: 0,
			brake: 0,
		};
		let info = modelType === 1 ? this.modelsMotoInfo[modelIndex] : this.modelsCarsInfo[modelIndex];
		//world, position, rotation, wheelsSetup, ctrls, carData, com, constants
		let vehicle = new Vehicle({
			world: this.world,
			position,
			rotation,
			wheelsSetup: info.wheelsSetup,
			ctrls,
			carData: info.chassisData,
			com: info.com,
			constants: info.constants,
		});

		const playerWrapper = {
			userID,
			ctrls,
			vehicle,
			modelIndex,
			modelType,
			name,
			position,
			rotation,
		};

		this.players.set(userID, playerWrapper);
		this.playersArray.push(playerWrapper);
	}

	removePlayer({ userID }) {
		const player = this.players.get(userID);
		if (!player) return;
		player.vehicle.destroy();
		this.players.delete(userID);
		const index = this.playersArray.indexOf(player);
		this.playersArray.splice(index, 1);
	}

	loop() {
		if (!this.looping) return;
		// const used = process.memoryUsage().heapUsed / 1024 / 1024;
		// console.log(`The script uses approximately ${Math.round(used * 100) / 100} MB`);
		const currentTime = performance.now();
		const delta = (currentTime - this.lastTime) * 0.001;
		const updateDelta = (currentTime - this.lastUpdateTime) * 0.001;
		this.update(delta);

		setTimeout(this.loop, this.frequency);
		if (updateDelta > 0.05) {
			this.sendData(currentTime);
		}
		this.lastTime = currentTime;
	}

	sendData(currentTime) {
		this.lastUpdateTime = performance.now();

		let playersInfo = this.playersArray.map((player) => {
			let controller = player.vehicle.vehicleController.controller;
			let chassis = controller.chassis();
			let t = chassis.translation();
			let r = chassis.rotation();
			let l = chassis.linvel();
			let a = chassis.angvel();
			let id = player.userID;
			let mi = player.modelIndex;
			let mt = player.modelType;
			let nm = player.name;
			let c = player.ctrls;
			let ws = controller.wheelSteering(0);
			return { t, r, l, a, id, mi, mt, nm, c, ws };
		}, {});
		let dateNow = Date.now();
		this.updatePhysics({ playersInfo, dateNow, currentTime });
		//process.send({
		//	type: "update",
		///	data: { playersInfo, dateNow, currentTime },
		//});
	}

	applyInputs({ userID, inputs }) {
		const player = this.players.get(userID);
		if (!player) return;
		Object.keys(inputs).forEach((key) => (player.ctrls[key] = inputs[key]));
	}

	updatePlayers(delta) {
		this.playersArray.forEach((player) => {
			player.vehicle.update(delta);
		});
	}

	update(realDelta) {
		this.world.timestep = realDelta;
		this.world.step(this.eventsQueue);
		this.updatePlayers(realDelta);
	}

	dispose() {
		this.looping = false;
	}
}
//const physics = new PhysicsRapier();
//physics.init({ frequency: 1000 / 120 });
module.exports = { PhysicsRapier };

///////////////////////////////////////////////////////////

class Environment {
    constructor(world) {
        this.world = world;
        this.rigidBodies = [];
        this.colliders = [];
    }
    destroy() {
        while (this.colliders.length) {
            this.world.removeCollider(this.colliders.pop());
        }
        while (this.rigidBodies.length) {
            this.world.removeRigidBody(this.rigidBodies.pop());
        }
    }
    addMap(map) {
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0))
        const colliderDesc = RAPIER.ColliderDesc
            //.roundConvexMesh(new Float32Array(map.vertices), new Uint32Array(map.indices), 2)
            //.roundConvexHull(new Float32Array(map.vertices), 2)
            .trimesh(map.vertices, map.indices)
            .setRestitution(0.1)
            .setFriction(1)
            //.setTranslation(map.position.x, map.position.y, map.position.z)
            .setCollisionGroups(interactionGroups(0, [1, 2]))
            .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED | RAPIER.ActiveCollisionTypes.DYNAMIC_FIXED)

        const collider = this.world.createCollider(colliderDesc, body);
        collider.userData = { isEnvironment: true };
        this.rigidBodies.push(body)
        this.colliders.push(collider)
    }

}

class VehicleController {

    constructor({ world, chassis, wheelsSetup }) {
        this.world = world;
        if (!chassis) {
            const mes = "VehicleController constructor: chassis is missing";
            console.warn(mes)
            throw Error(mes)
        }

        this.controller = this.world.createVehicleController(chassis);
        const suspensionDirection = new RAPIER.Vector3(0, -1, 0)

        wheelsSetup.forEach((wheel) => {
            this.controller.addWheel(wheel.position, suspensionDirection, wheel.axleCs, wheel.suspensionRestLength, wheel.radius)
        })

        wheelsSetup.forEach((wheel, index) => {
            this.controller.setWheelSuspensionStiffness(index, wheel.suspensionStiffness)
            this.controller.setWheelMaxSuspensionTravel(index, wheel.maxSuspensionTravel)
            this.controller.setWheelFrictionSlip(index, 20)
        })
    }
    destroy() {
        this.world.removeVehicleController(this.controller)
        this.controller = null
    }
    update(delta) {
        if (!this.controller) return
        const controller = this.controller
        controller.updateVehicle(delta)
    }
}

class Vehicle {
    constructor({ world, position, rotation, wheelsSetup, ctrls, carData, com, constants }) {
        //world, position, rotation, wheelsSetup, ctrls, carData, com, constants
        this.world = world;
        this.wheelsSetup = wheelsSetup;
        let baseMass = constants.mass;
        let linearDamping = constants.linearDamping;
        let angularDamping = constants.angularDamping
        this.position = position;
        this.rotation = rotation;
        const carBody = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(position.x, position.y, position.z)
                .setRotation(setFromEulerAngles(rotation.x, rotation.y, rotation.z))
                .setCanSleep(false)
                .setAdditionalMassProperties(
                    baseMass,                        // Mass.
                    com, // Center of mass.
                    { x: 1, y: 1, z: 1 }, // Principal angular inertia.
                    { w: 1, x: 0, y: 0.0, z: 0.0 } // Principal angular inertia frame (unit quaternion).
                )
                .setAngularDamping(angularDamping)
                .setLinearDamping(linearDamping)

            //.restrictRotations(false, true, true, true)
        );

        //ColliderDesc.convexHull
        //ColliderDesc.convexMesh
        const carShape = RAPIER.ColliderDesc
            .convexHull(new Float32Array(carData.vertices))
            .setMass(baseMass)
            .setRestitution(0.1)
            .setFriction(1)
            .setCollisionGroups(interactionGroups(1, [0, 1]))
            .setDensity(0.5)

            .setActiveCollisionTypes(
                RAPIER.ActiveCollisionTypes.DEFAULT |
                RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED |
                RAPIER.ActiveCollisionTypes.DYNAMIC_FIXED
            );

        world.createCollider(carShape, carBody);

        carBody.recomputeMassPropertiesFromColliders()
        this.carRigidBody = carBody;
        this.carCollider = carShape;
        this.vehicleController = new VehicleController({
            world,
            chassis: carBody,
            wheelsSetup,
        });

        this.accelerateForce = constants.accelerateForce;
        this.accelerateBack = constants.accelerateBack;

        this.brakeForce = constants.brakeForce;
        this.steerAngle = constants.steerAngle;
        if (ctrls) {
            this.controls = ctrls;
        } else {
            this.controls = {
                forward: 0,
                back: 0,
                left: 0,
                right: 0,
                reset: 0,
                brake: 0,
            };
        }
    }
    update(delta) {
        if (!this.vehicleController) return;

        const controls = this.controls;

        const t = 1.0 - Math.pow(0.01, delta);
        const controller = this.vehicleController.controller;
        const chassisRigidBody = controller.chassis();

        if (this.newVals) {
            const { t, r, l, a, ws, c } = this.newVals;
            chassisRigidBody.setRotation(r, true);
            chassisRigidBody.setTranslation(t, true);
            chassisRigidBody.setLinvel(l, true);
            chassisRigidBody.setAngvel(a, true);
            for (let j = 0; j < 2; j++) {
                controller.setWheelSteering(j, ws)
            }
            Object.keys(c).map(key => {
                this.controls[key] = c[key]
            })

            this.newVals = null;
        }
        // rough ground check
        let outOfBounds = false;

        const raycastResult = this.world.castRay(
            new RAPIER.Ray(chassisRigidBody.translation(), { x: 0, y: -1, z: 0 }),
            1,
            false,
            undefined,
            undefined,
            undefined,
            chassisRigidBody
        );

        let ground_current = undefined;

        if (raycastResult) {
            const collider = raycastResult.collider;
            const userData = collider?.parent()?.userData;
            outOfBounds = userData?.outOfBounds;

            ground_current = collider;
        }

        const engineForce =
            Number(controls.forward) * this.accelerateForce -
            Number(controls.back) * this.accelerateBack;


        for (let i = 0; i < this.wheelsSetup.length; i++) {
            controller.setWheelEngineForce(i, this.wheelsSetup[i].engine * engineForce);
        }

        const wheelBrake = Number(controls.brake) * this.brakeForce;
        for (let i = 0; i < this.wheelsSetup.length; i++) {
            controller.setWheelBrake(i, this.wheelsSetup[i].brake * wheelBrake);
        }

        const currentSteering = controller.wheelSteering(0) || 0;
        const steerDirection = Number(controls.left) - Number(controls.right);

        const steering = lerp(
            currentSteering,
            this.steerAngle * steerDirection,
            0.5
        );
        for (let i = 0; i < this.wheelsSetup.length; i++) {
            controller.setWheelSteering(i, this.wheelsSetup[i].steer * steering);

        }
        /*
          // air control
          if (!ground_current) {
              const forwardAngVel = Number(controls.forward) - Number(controls.back)
              const sideAngVel = Number(controls.left) - Number(controls.right)
    
              const angvel = transformVector({ x: 0, y: sideAngVel * t, z: forwardAngVel * t }, chassisRigidBody.rotation())
              const chassAngvel = chassisRigidBody.angvel()
              chassisRigidBody.setAngvel({ x: angvel.x + chassAngvel.x, y: angvel.y + chassAngvel.y, z: angvel.z + chassAngvel.z }, true)
          }
          */

        if (controls.reset || outOfBounds) {
            chassisRigidBody.setTranslation(new RAPIER.Vector3(this.position.x, this.position.y, this.position.z), true);
            const spawnQuat = setFromEulerAngles(this.rotation.x, this.rotation.y, this.rotation.z);
            chassisRigidBody.setRotation(spawnQuat, true);
            chassisRigidBody.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
            chassisRigidBody.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
            chassisRigidBody.reset = 0;
        }

        this.vehicleController.update(delta);
    }
    destroy() {
        this.vehicleController.destroy();
        this.vehicleController = null;
        this.world.removeCollider(this.carCollider);
        this.carCollider = null;
        this.world.removeRigidBody(this.carRigidBody);
        this.carRigidBody = null;
    }
}

function setFromEulerAngles(ex, ey, ez) {
    const halfToRad = 0.5 * Math.PI / 180;
    ex *= halfToRad;
    ey *= halfToRad;
    ez *= halfToRad;

    const sx = Math.sin(ex);
    const cx = Math.cos(ex);
    const sy = Math.sin(ey);
    const cy = Math.cos(ey);
    const sz = Math.sin(ez);
    const cz = Math.cos(ez);

    const x = sx * cy * cz - cx * sy * sz;
    const y = cx * sy * cz + sx * cy * sz;
    const z = cx * cy * sz - sx * sy * cz;
    const w = cx * cy * cz + sx * sy * sz;

    return { x, y, z, w };
}
function transformVector(vec, quat) {
    const x = vec.x, y = vec.y, z = vec.z;
    const qx = quat.x, qy = quat.y, qz = quat.z, qw = quat.w;

    // calculate quat * vec
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;

    // calculate result * inverse quat
    const rx = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    const ry = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    const rz = iz * qw + iw * -qz + ix * -qy - iy * -qx;

    return { x: rx, y: ry, z: rz };
}
function clamp(value, min, max) {
    if (value >= max) return max;
    if (value <= min) return min;
    return value;
}
function lerp(a, b, alpha) {
    return a + (b - a) * clamp(alpha, 0, 1);
}
function interactionGroups(memberships, filters) {
    const bitmask = (groups) => {
        return [groups].flat().reduce((acc, layer) => acc | (1 << layer), 0)
    }

    return (bitmask(memberships) << 16) +
        (filters !== undefined ? bitmask(filters) : 0b1111_1111_1111_1111)
}
