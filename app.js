// Firebase読み込み
import { db } from "./firebase.js";
import { doc, updateDoc, onSnapshot } from "firebase/firestore";

// ボタン操作
document.getElementById("rollBtn").onclick = async () => {
  await updateDoc(doc(db, "rooms", "room1"), {
    player1Roll: "pending"
  });
};

// リアルタイム監視
onSnapshot(doc(db, "rooms", "room1"), (docSnap) => {
  const data = docSnap.data();

  if (data.result) {
    document.getElementById("result").innerText =
      `P1: ${data.player1Roll}, P2: ${data.player2Roll}`;
  }
});