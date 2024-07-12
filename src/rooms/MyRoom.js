const { Room } = require("colyseus");

const { MyRoomState } = require("./schema/MyRoomState.js");
const wheelsSetup = require("../constants/wheelsSetup");
const maps = require("../constants/maps");
const carShape = require("../constants/carShape");

const { Physics } = require("../physics/Physics");
const { SnapshotInterpolation } = require("@geckos.io/snapshot-interpolation");
const { Player } = require("./schema/entities/Player");
const { Spectator } = require("./schema/entities/Spectator");

class MyRoom extends Room {
  maxClients = 100;

  async onCreate(options) {
    this.setState(new MyRoomState());
    const updatePhysics = this.updatePhysics.bind(this)
    this.physics = new Physics({ wheelsSetup, maps, carShape }, updatePhysics);
    await this.physics.init()
    //this.physics.setConfig({ wheelsSetup, maps, carShape });
    this.time = Date.now();
    // server interpolation tool, updated 20 times per second (50ms interval)
    //this.si = new SnapshotInterpolation(20);
    //this.updateRate = 50;

    this.setHandlers();

    //this.physics.on("update", this.updatePhysics.bind(this));
    //this.setSimulationInterval(() => this.update(), this.updateRate);
  }

  onJoin(client, options) {
    //console.log("client",client)
    //console.log("options",options)
    console.log(client.sessionId, "joined!");
    
    
    const userID = client.id;
    const { position, rotation, ctrls, isSpectator, name, modelIndex } = options;

    if (isSpectator) {
      const spectator = new Spectator(userID);
      this.state.spectators.set(userID, spectator);
      return;
    }

    let player = this.state.players.get(userID);
    let message = "room:player:joined";
    if (!player) {
      player = new Player(userID,name,  modelIndex)
    }
    this.state.players.set(userID, player);
    this.physics.addPlayer({ userID, position, rotation, ctrls, modelIndex });
    message = "room:player:joined";
    this.broadcast(message, { player, userID });
  }

  onLeave(client, consented) {
    const userID = client.id;
    const player = this.state.players.get(userID);

    const spectator = this.state.spectators.get(userID);

    if (player) {
      this.state.players.delete(userID);
      this.broadcast("room:player:left", { userID });
    }

    if (spectator) {
      this.state.spectators.delete(userID);
    }

    this.physics.removePlayer({ userID });
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }
  setHandlers() {
    this.onMessage("room:player:input", (client, data) => {
      const userID = client.id;
      const player = this.state.players.get(userID);
      if (!player) return;
      
      this.physics.applyInputs({
        userID,
        inputs: data.inputs,
      });
    });
  }
  updatePhysics(data) {
    this.broadcast("room:state:update", data);
  }
  update() {
    // create a snapshot
    //const snapshot = this.si.snapshot.create(this.dataToSend);
    
    // convert it to a buffer (smaller size)
    //const buffer = SnapshotModel.toBuffer(snapshot);
    //this.si.vault.add(snapshot);
    
    // update all features
    //this.featuresArray.forEach((feature) => feature.update(delta));
    //console.log("this.dataToSend",this.dataToSend)
    //this.broadcastPatch();
    //this.broadcast("room:state:update", JSON.stringify(this.dataToSend));
  }
}
module.exports.MyRoom = MyRoom;