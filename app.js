// Firebase読み込み
import { db } from "./firebase.js";
import { doc, updateDoc, onSnapshot } from "firebase/firestore";

// ボタン操作
document.getElementById("rollBtn").onclick = async () => {
  const roll = Math.floor(Math.random() * 6) + 1;

  await updateDoc(doc(db, "rooms", "room1"), {
    player1Roll: roll
  });
};

// リアルタイム監視
onSnapshot(doc(db, "rooms", "room1"), (docSnap) => {
  const data = docSnap.data();

  if (data.player1Roll && data.player2Roll) {
    let result = "draw";
    if (data.player1Roll > data.player2Roll) result = "p1";
    if (data.player2Roll > data.player1Roll) result = "p2";

    document.getElementById("result").innerText =
      `P1: ${data.player1Roll}, P2: ${data.player2Roll}`;
  }
});