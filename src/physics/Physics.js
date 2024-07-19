//const { fork } = require("child_process");
const{PhysicsRapier} = require("./PhysicsFork")

class Physics {
	constructor({ modelsInfo, maps, spawnPoints }, updatePhysics, updateInputs)  {

		this.physicsRapier= new PhysicsRapier({ modelsInfo, maps, spawnPoints }, updatePhysics);
		this.messageCallbacks = {};
		this.asyncCalls = {};
		this.updateInputs = updateInputs;
		/*
		this.fork = fork("src/physics/PhysicsFork.js", null, {
			silent: true,
			detached: true,
			stdio: "ignore",
		});
		this.fork.on("message", this._onMessage.bind(this));
		*/
		
	}
	async init(){
		await this.physicsRapier.init({ frequency: 1000 / 120 });
	}
	_onMessage(message) {
		if (this.asyncCalls[message.asyncID]) {
			this.asyncCalls[message.asyncID](message.data);
			delete this.asyncCalls[message.data.id];
		}
		if (this.messageCallbacks[message.type]) {
			this.messageCallbacks[message.type].forEach((cb) => cb(message.data));
		}
	}

	addPlayer(data) {
		console.log(data)
		//this.fork.send({ type: "addPlayer", data });
		this.physicsRapier.addPlayer(data)
	}

	removePlayer(data) {
		//this.fork.send({ type: "removePlayer", data });
		this.physicsRapier.removePlayer(data)
	}

	applyInputs(data) {
		//this.fork.send({ type: "applyInputs", data });
		this.physicsRapier.applyInputs(data)
		this.updateInputs(data)
	}

	setConfig(data) {
		//this.fork.send({ type: "setConfig", data });
		this.physicsRapier.setConfig(data)
	}

	on(messageType, callback) {
		if (!this.messageCallbacks[messageType]) {
			this.messageCallbacks[messageType] = [callback];
		} else {
			this.messageCallbacks[messageType].push(callback);
		}
	}


	off(messageType, callback) {
		if (this.messageCallbacks[messageType]) {
			this.messageCallbacks[messageType] = this.messageCallbacks[messageType].filter((cb) => cb !== callback);
		}
	}

	kill() {
		this.messageCallbacks = {};
		this.asyncCalls = {};
		//this.fork.kill();
	}
}

module.exports.Physics = Physics;
