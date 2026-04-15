// Firebase読み込み
import { db, auth } from "./firebase.js";
import {
  doc,
  updateDoc,
  onSnapshot,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let uid = null;
let currentRoomData = null;

function get_result_msg(p1roll, p2roll) {
  if (p1roll > p2roll) {
    return "p1 won";
  } else if (p1roll < p2roll) {
    return "p2 won";
  } else {
    return "draw";
  }
}

// ボタン操作
document.getElementById("rollBtn").onclick = async () => {
  if (!uid || !currentRoomData) {
    alert("まだ初期化されていません");
    return;
  }
  if (!currentRoomData.player1 || !currentRoomData.player2) {
    alert("まだ対戦相手がいません");
    return;
  }
  if (!(currentRoomData.player1 === uid || currentRoomData.player2 === uid)) {
    alert("このルームの参加者ではありません");
    return;
  }

  const roll = Math.floor(Math.random() * 6) + 1;

  const roomRef = doc(db, "rooms", "room1");

  if (currentRoomData.player1 === uid) {
    if (!currentRoomData.player1Roll) {
      await updateDoc(roomRef, {
        player1Roll: roll
      });
    } else {
      alert("player1は既にサイコロを振っています");
      return;
    }
  } else {
    if (!currentRoomData.player2Roll) {
      await updateDoc(roomRef, {
        player2Roll: roll
      });
    } else {
      alert("player2は既にサイコロを振っています");
      return;
    }
  }
  if (currentRoomData.player1Roll && currentRoomData.player2Roll) {
    let res = get_result_msg(currentRoomData.player1Roll, currentRoomData.player2Roll);
    await updateDoc(roomRef, {
      result: res
    });
  }
};

// リアルタイム監視
onSnapshot(doc(db, "rooms", "room1"), (docSnap) => {
  const data = docSnap.data();
  currentRoomData = data;

  if (data.player1Roll && data.player2Roll) {
    let result = get_result_msg(data.player1Roll, data.player2Roll);
    document.getElementById("result").innerText =
      `P1: ${data.player1Roll}, P2: ${data.player2Roll} -> ${result}`;
  } else {
    let msg_p1 = data.player1Roll;
    let msg_p2 = data.player2Roll;
    if (!msg_p1) msg_p1 = "waiting for rolling";
    if (!msg_p2) msg_p2 = "waiting for rolling";

    document.getElementById("result").innerText =
      `P1: ${msg_p1}, P2: ${msg_p2}`;
  }
});

// 匿名ログイン
signInAnonymously(auth)
  .then(() => {
    console.log("ログイン成功");
  })
  .catch((error) => {
    console.error(error);
  });

// ユーザー状態監視
onAuthStateChanged(auth, async (user) => {
  if (user) {
    uid = user.uid;
    console.log("UID:", uid);

    const roomRef = doc(db, "rooms", "room1");
    const roomSnap = await getDoc(roomRef);
    const data = roomSnap.data();

    if (!data) {
      console.log("firestoreにデータ無し");
      return;
    }

    if (!data.player1) {
      console.log("player1として登録: " + uid);
      await updateDoc(roomRef, { player1: uid });
    } else if (!data.player2) {
      console.log("player2として登録: " + uid);
      await updateDoc(roomRef, { player2: uid });
    }

    if (data.player1 === uid || data.player2 === uid) {
      return;
    }
  }
});