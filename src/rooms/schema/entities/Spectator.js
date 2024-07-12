const { defineTypes, Schema } = require("@colyseus/schema");
class Spectator extends Schema {
    constructor(userID) {
		super();
		this.userID = userID;
	}
}
defineTypes(Spectator, {
	userID: "string",
});

exports.Spectator = Spectator;
