const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.onRoll = functions.firestore
  .document("rooms/{roomId}")
  .onUpdate((change, context) => {
    const data = change.after.data();

    // 両者がrollしたら
    if (data.player1Roll === "pending" && data.player2Roll === "pending") {
      const p1 = Math.floor(Math.random() * 6) + 1;
      const p2 = Math.floor(Math.random() * 6) + 1;

      let result = "draw";
      if (p1 > p2) result = "p1";
      if (p2 > p1) result = "p2";

      return change.after.ref.update({
        player1Roll: p1,
        player2Roll: p2,
        result: result
      });
    }

    return null;
  });