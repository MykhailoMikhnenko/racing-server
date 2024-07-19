const { defineTypes, Schema } = require("@colyseus/schema");
class Player extends Schema {
    constructor(userID, name, modelIndex, modelType) {
		super();
		this.userID = userID;
		this.name = name;
		this.modelIndex =modelIndex;
		this.modelType =modelType;
	}
}
defineTypes(Player, {
	userID: "string",
	name: "string",
	modelIndex: "int8",
	modelType: "int8",
});
exports.Player = Player;
