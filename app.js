// Firebase読み込み
import { db } from "./firebase.js";
import {
  doc,
  updateDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ボタン操作
document.getElementById("rollBtn").onclick = async () => {
  const roll = Math.floor(Math.random() * 6) + 1;
  const isPlayer1 = Math.random() > 0.5;

  if (isPlayer1) {
    await updateDoc(doc(db, "rooms", "room1"), {
      player1Roll: roll
    });
  } else {
    await updateDoc(doc(db, "rooms", "room1"), {
      player2Roll: roll
    });
  }

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