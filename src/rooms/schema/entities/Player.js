const { defineTypes, Schema } = require("@colyseus/schema");
class Player extends Schema {
    constructor(userID, name, modelIndex) {
		super();
		this.userID = userID;
		this.name = name;
		this.modelIndex =modelIndex;
	}
}
defineTypes(Player, {
	userID: "string",
	name: "string",
	modelIndex: "int8",
});
exports.Player = Player;
