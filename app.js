// Firebase読み込み
import { db } from "./firebase.js";
import {
  doc,
  updateDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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

let uid = null;

// 匿名ログイン
signInAnonymously(auth)
  .then(() => {
    console.log("ログイン成功");
  })
  .catch((error) => {
    console.error(error);
  });

// ユーザー状態監視
onAuthStateChanged(auth, (user) => {
  if (user) {
    uid = user.uid;
    console.log("UID:", uid);
  }
});

const roomRef = doc(db, "rooms", "room1");
const roomSnap = await getDoc(roomRef);
const data = roomSnap.data();

if (!data.player1) {
  await updateDoc(roomRef, { player1: uid });
} else if (!data.player2) {
  await updateDoc(roomRef, { player2: uid });
}