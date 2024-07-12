const { defineTypes, Schema, MapSchema } = require("@colyseus/schema");
const { Player } = require("./entities/Player");
const { Spectator } = require("./entities/Spectator");

class MyRoomState extends Schema {
  constructor() {
    super();
    this.mySynchronizedProperty = "Hello world";
    this.players = new MapSchema();
		this.spectators = new MapSchema();
    //this.dataToSend = 
  }
}

defineTypes(MyRoomState, {
  mySynchronizedProperty: "string",
  players: { map: Player },
	spectators: { map: Spectator },
});

exports.MyRoomState = MyRoomState;
