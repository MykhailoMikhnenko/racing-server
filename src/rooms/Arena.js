const { Room } = require("colyseus");
const BuffRoomFeature = require("@features/Room/BuffsRoomFeature");
const BreakablesRoomFeature = require("@features/Room/BreakablesRoomFeature");
const RocketsRoomFeature = require("@features/Room/RocketsRoomFeature");
const MineRoomFeature = require("@features/Room/MinesRoomFeature");
const LeaderboardRoomFeature = require("@features/Room/LeaderboardRoomFeature");
const RampageRoomFeature = require("@features/Room/RampageRoomFeature");
const ExplosivesRoomFeature = require("@features/Room/ExplosivesRoomFeature");
const { BotsRoomFeature } = require("@features/Room/BotsRoomFeature");
const Events = require("@events/events");

const { SnapshotInterpolation } = require("@geckos.io/snapshot-interpolation");
const autobind = require("@utils/autobind");
const { getDistance } = require("@utils/math");

const { Player, SnapshotModel } = require("./schema/entities/Player");
const { Profile } = require("./schema/entities/Profile");
const { PROCESS_ROOMS_STATES, USERS_ROOMS_SEATS_RESERVATIONS } = require("../../constants/redisKeys");
const { ROOMS_CONFIG } = require("../../constants/roomsGlobalConfig");
const { redisPresence } = require("../../helpers/redisClient");
const { Spectator } = require("./schema/entities/Spectator");
const { Physics } = require("../physics/Physics");
const { ArenaState } = require("./schema/ArenaState");

/**
 * @typedef {{
 * 		userID: string;
 * 		userName: string,
 * 		wallet: number;
 * 		isSpectator: boolean;
 * }} UserInfo
 * */

class Arena extends Room {
	/** @type {Physics} */
	physics = null;

	/** @type {ArenaState} */
	state;

	isRestored = false;

	roomConfig = ROOMS_CONFIG.Arena;

	maxClients = ROOMS_CONFIG.Arena.maxUsers;

	autoDispose = false;

	StateSchema = ArenaState;

	getProcessStateKey = () => PROCESS_ROOMS_STATES(this.listing.publicAddress);

	getRoomInstanceKey = () => `${this.roomName}:${this.roomId}`;

	// M.b. We  will use mongo instead
	updateRoomStorage = () => redisPresence.hset(this.getProcessStateKey(), this.getRoomInstanceKey(), JSON.stringify(this.state));

	async onCreate(options) {
		autobind(this);
		if (options.roomId) {
			this.roomId = options.roomId;
		}
		this.afterPatch = [];

		const persistedState = await redisPresence.hget(this.getProcessStateKey(), this.getRoomInstanceKey());
		this.setState(new this.StateSchema());

		// disable patch rate as we send them manually
		this.setPatchRate(null);
		this.setSeatReservationTime(100);
		this.events = new Events();
		// server interpolation tool, updated 20 times per second (50ms interval)
		this.si = new SnapshotInterpolation(20);
		this.leaderBoardUpdateInterval = 1000;
		this.leaderBoardUpdateTimer = 0;
		this.updateRate = 50;
		/** @type {Physics} */
		this.physics = new Physics();
		this.physics.setConfig(this.roomConfig);
		this.time = Date.now();

		this.setHandlers();

		this.initFeatures();

		if (persistedState) {
			this.restoreRoomState(JSON.parse(persistedState));
		}
		this.physics.on("update", this.updatePhysics);
		this.physics.on("hitPlayer", this.hitPlayer);

		await this.updateRoomStorage();
		this.setSimulationInterval((delta) => this.update(delta), this.updateRate);
	}

	initFeatures() {
		this.features = {
			buff: new BuffRoomFeature(this),
			breakables: new BreakablesRoomFeature(this),
			rockets: new RocketsRoomFeature(this),
			mines: new MineRoomFeature(this),
			bots: new BotsRoomFeature(this),
			explosives: new ExplosivesRoomFeature(this),
			leaderboard: new LeaderboardRoomFeature(this),
			rampage: new RampageRoomFeature(this),
		};
		this.featuresArray = Object.values(this.features);
		this.featuresArray.forEach((feature) => feature.init());
	}

	/**
	 * update loop for the room, runs every 50ms
	 * @param {number} delta - time passed since last update (in milliseconds)
	 */
	update(delta) {
		// transform delta to seconds
		delta *= 0.001;

		const players = [];
		for (const player of this.state.players.values()) {
			if (player.rampageActive) {
				this.features.rampage.applyRampage(player);
			}
			players.push({
				id: player.userID,
				x: player.x,
				y: player.y,
				z: player.z,
				targetX: player.targetX,
				targetY: player.targetY,
				targetZ: player.targetZ,
				animation: player.animation,
				stamina: player.stamina,
			});
		}
		// create a snapshot
		const snapshot = this.si.snapshot.create(players);
		// convert it to a buffer (smaller size)
		const buffer = SnapshotModel.toBuffer(snapshot);
		this.si.vault.add(snapshot);
		// update all features
		this.featuresArray.forEach((feature) => feature.update(delta));

		this.broadcastPatch();
		this.broadcast("room:state:update", buffer);
		this.afterPatch.forEach((fn) => fn());
		this.afterPatch.length = 0;
	}

	/**
	 * add function to be called after patch is sent
	 * @param {CallableFunction} fn
	 */
	addAfterPatch(fn) {
		this.afterPatch.push(fn);
	}

	/**
	 * @param {{
	 * 	players: {
	 * 	   userID: string,
	 *     position: {x: number, y: number, z: number },
	 *  }
	 * }} data
	 */
	updatePhysics(data) {
		const { players } = data;
		const delta = (Date.now() - this.time) * 0.001;
		this.time = Date.now();

		for (const player of this.state.players.values()) {
			if (!players[player.userID]) continue;
			const { position } = players[player.userID];
			Object.assign(player, position);

			player.update(delta);
		}
	}

	async hitPlayer({ distance, blowRadius, ownerID, victimID, weaponType }) {
		const hitter = this.state.players.get(ownerID);
		const victim = this.state.players.get(victimID);
		if (!victim || !hitter) return;
		if (victim.health === 0 || victim.invincible || victim.isJumping) return;

		if (victim.rampageActive && weaponType === "mine") {
			return;
		}

		let weaponDamage = hitter.features.weapon.getDamage(weaponType);
		if (distance) {
			weaponDamage = Math.floor(weaponDamage * (1 - distance / (blowRadius * 2)));
		}

		const { isAlive } = victim.features.health.takeDamage(weaponDamage);

		this.broadcast("room:player:hit", {
			newHealth: victim.health,
			damage: weaponDamage,
			multiplier: 1,
			ownerID,
			userID: victimID,
		});

		if (!isAlive) {
			victim.deaths += 1;
			if (victim !== hitter) {
				hitter.kills += 1;
				hitter.features.rampage.boostRampageLoading();
			}
			this.broadcast("room:player:die", { victim, killerID: ownerID, userID: victimID });

			this.physics.updatePlayer({
				userID: victimID,
				speed: victim.speed,
				isAlive: false,
			});
			this.features.leaderboard.updateLeaderboard();
		}

		await this.updateRoomStorage();
	}

	/**
	 * @param {ArenaState} oldState
	 * */
	restoreRoomState(oldState) {
		// Restore players
		Object.values(oldState.players).forEach((playerOldState) => {
			if (playerOldState.isBot) {
				return;
			}
			const player = /** @type {import('./schema/entities/Player').FeaturedPlayer} * */ (new Player(playerOldState.userID, false));
			player.isActive = false;
			Object.assign(player, playerOldState);

			player.features.weapon.setWeapon(playerOldState.weaponType);

			if (playerOldState.profile) {
				player.profile = new Profile(playerOldState.profile);
			}
			this.state.players.set(playerOldState.userID, player);
		});

		this.isRestored = true;

		this.featuresArray.forEach((feature) => {
			feature.restore(oldState);
		});

		this.features.leaderboard.updateLeaderboard();
	}

	/**
	 * @param {*} client
	 * @param {UserInfo} userInfo
	 * @returns {Promise<UserInfo>}
	 */
	async onAuth(client, userInfo) {
		const { userID, isSpectator } = userInfo;
		// TODO: Write verify sessionID logic
		console.log("verify userID", userID);
		if (!userID) {
			throw new Error("'User' not found in the database!");
		}

		const userReservedRoomID = await redisPresence.hget(USERS_ROOMS_SEATS_RESERVATIONS(this.roomName), userID);

		if (!isSpectator && (!userReservedRoomID || this.roomId !== userReservedRoomID)) {
			throw new Error("User doesn't have a reserved seat.!");
		}

		const player = this.state.players.get(userID);
		if (player?.isActive) {
			throw new Error("Player already in a game");
		}

		return userInfo;
	}

	async onJoin(client) {
		const userID = client?.auth?.userID;
		const isSpectator = client?.auth?.isSpectator;

		if (isSpectator) {
			const spectator = new Spectator(userID);
			this.state.spectators.set(userID, spectator);
			this.features.leaderboard.updateLeaderboard();
			return;
		}

		let player = this.state.players.get(userID);
		let message = "room:player:joined";

		if (!player) {
			player = /** @type {import('./schema/entities/Player').FeaturedPlayer} * */ (new Player(userID));
			player.profile = new Profile(client.auth);
			console.log(userID, "joined!");
			this.state.players.set(userID, player);
			this.physics.addPlayer({ userID });
			message = "room:player:joined";
		} else {
			if (player.profile) {
				player.profile.updateFromUserInfo(client.auth);
			}
			console.log(userID, "rejoined!");
			message = "room:player:rejoined";
			this.physics.addPlayer({ userID, position: { x: player.x, y: player.y, z: player.z } });
		}

		this.broadcast(message, { player, userID });
		player.isActive = true;
		player.features.invincibility.setInvincible(2, false);

		this.features.leaderboard.updateLeaderboard();
		await this.updateRoomStorage();
	}

	async onLeave(client) {
		const userID = client?.auth?.userID;
		const player = this.state.players.get(userID);

		const spectator = this.state.spectators.get(userID);

		if (player) {
			player.isActive = false;
			const snapshot = this.si.vault.get();
			// @ts-ignore
			const playerState = snapshot.state.find((entity) => entity.id === userID);

			if (playerState) {
				player.x = playerState.x;
				player.y = playerState.y;
				player.z = playerState.z;
			}

			this.broadcast("room:player:left", { userID });
			this.features.leaderboard.updateLeaderboard();

			await this.updateRoomStorage();
		}

		if (spectator) {
			this.state.spectators.delete(userID);
		}

		this.physics.removePlayer({ userID });
	}

	async onDispose() {
		console.log("room", this.roomId, "disposing...");
		this.physics?.kill();
		await this.updateRoomStorage();
	}

	shootAuto(userID, data) {
		const player = this.state.players.get(userID);
		if (!data.origin || !data.target || !data.distance || Number.isNaN(data.origin.x) || Number.isNaN(data.target.x)) return;
		if (data.distance > player.weaponFireRange) return;
		this.physics.shootAuto({
			userID,
			origin: data.origin,
			target: data.target,
			distance: data.distance,
		});

		this.broadcast("room:player:shoot:auto", {
			userID,
			origin: data.origin,
			target: data.target,
			distance: data.distance,
		});
		let { time } = data;
		const { target } = data;
		time = Number(time);
		const shots = this.si.vault.get(time);
		if (!shots) return;

		const shot = this.si.interpolate(shots.older, shots.newer, time, "x y z");

		for (const entity of shot.state) {
			if (entity.id === player.userID) continue;
			const d = getDistance(entity, target);

			if (d < 1.5) {
				const victim = this.state.players.get(entity.id);
				if (victim.health === 0) continue;
				this.hitPlayer({ distance: 0, ownerID: userID, victimID: victim.userID, weaponType: "auto" });
				break;
			}
		}
	}

	setHandlers() {
		this.onMessage("room:player:weapon", (client, data) => {
			const player = this.state.players.get(client.auth.userID);
			player.features.weapon.setWeapon(data.weaponType);
			this.broadcast("room:player:weapon", { userID: client.auth.userID, weaponType: data.weaponType });
		});

		this.onMessage("room:player:input", (client, data) => {
			const userID = client?.auth?.userID;
			const player = this.state.players.get(userID);
			if (player.health === 0) return;
			const last = data.inputs.at(-1);

			if (last) {
				player.wouldSprint = last.wouldSprint;
				player.animation = last.animation;
				player.targetX = last.target.x;
				player.targetY = last.target.y;
				player.targetZ = last.target.z;
				player.isMoving = last.inputMove.x !== 0 || last.inputMove.z !== 0;
				player.isJumping = last.isJumping;

				if (last.wouldReload) {
					player.features.weapon.reload();
				}
			}

			this.physics.applyInputs({
				userID,
				inputs: data.inputs,
			});
		});

		this.onMessage("room:player:shoot:auto", (client, data) => {
			const userID = client?.auth?.userID;
			const player = this.state.players.get(userID);
			if (player.health === 0 || player.invincible === 1) return;
			const shot = player.features.weapon.shoot();
			if (!shot) return;
			this.shootAuto(userID, data);
		});

		this.onMessage("room:player:respawn", async (client) => {
			const userID = client?.auth?.userID;
			const player = this.state.players.get(userID);
			if (player.health !== 0) return;
			const { position } = await this.physics.respawn({ userID });
			player.features.invincibility.setInvincible(2, false);
			player.features.weapon.fullReload();

			player.features.health.restoreFullHealth();
			this.features.leaderboard.updateLeaderboard();
			player.x = position.x;
			player.y = position.y;
			player.z = position.z;
			this.broadcast("room:player:respawn", { userID, position });
			this.updateRoomStorage();
		});

		this.onMessage("room:player:loaded", (client, data) => {
			const userID = client?.auth?.userID;
			const player = this.state.players.get(userID);
			if (!data.profile || !player) return;
			player.profile = new Profile(data.profile);
			this.broadcast("room:player:loaded", { profile: player.profile, userID });
		});

		this.onMessage("room:rtt", (client) => {
			client.send("room:rtt", Date.now());
		});
	}
}

exports.Arena = Arena;
