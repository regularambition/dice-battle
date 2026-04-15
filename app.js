// Firebase読み込み
import { db, auth } from "./firebase.js";
import {
  doc,
  updateDoc,
  onSnapshot,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let uid = null;
let currentRoomData = null;
let isAuthChecked = false;
let playerName = null;

function showScreen(screenId) {
  const screens = ["screen-title", "screen-name", "screen-menu"];

  screens.forEach(id => {
    document.getElementById(id).style.display = "none";
  });

  document.getElementById(screenId).style.display = "block";
}

window.onload = () => {
  showScreen("screen-title");
};

document.getElementById("startBtn").onclick = () => {
  if (!isAuthChecked) {
    alert("まだ初期化中です");
    return;
  }

  if (uid && playerName) {
    // 既存ユーザー
    document.getElementById("playerName").innerText =
      `プレイヤー名：${playerName}`;
    showScreen("screen-menu");
  } else {
    // 新規ユーザー
    showScreen("screen-name");
  }
};

document.getElementById("nameSubmit").onclick = async () => {
  const name = document.getElementById("nameInput").value;

  if (!name) {
    alert("名前を入力してください");
    return;
  }

  const regex = /^[A-Za-z0-9]+$/;
  if (!regex.test(name)) {
    alert("大文字・小文字・アラビア数字のみが利用できます");
    return;
  }

  playerName = name;

  try {
    await signInAnonymously(auth);
    document.getElementById("playerName").innerText =
      `プレイヤー名：${playerName}`;
    showScreen("screen-menu");
  } catch (e) {
    console.error(e);
  }
};

function get_result_msg(p1roll, p2roll) {
  if (p1roll > p2roll) {
    return "p1 won";
  } else if (p1roll < p2roll) {
    return "p2 won";
  } else {
    return "draw";
  }
}

function render(data) {
  if (data.player1Roll && data.player2Roll) {
    const result = get_result_msg(data.player1Roll, data.player2Roll);
    return `P1: ${data.player1Roll}, P2: ${data.player2Roll} -> ${result}`;
  } else {
    return `P1: ${data.player1Roll ?? "waiting"}, P2: ${data.player2Roll ?? "waiting"}`;
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
    if (currentRoomData.player1Roll == null) {
      await updateDoc(roomRef, {
        player1Roll: roll
      });
    } else {
      alert("player1は既にサイコロを振っています");
      return;
    }
  } else {
    if (currentRoomData.player2Roll == null) {
      await updateDoc(roomRef, {
        player2Roll: roll
      });
    } else {
      alert("player2は既にサイコロを振っています");
      return;
    }
  }
};

// リアルタイム監視
onSnapshot(doc(db, "rooms", "room1"), async (docSnap) => {
  const data = docSnap.data();
  currentRoomData = data;

  if (data.player1Roll && data.player2Roll && !data.result) {
    const result = get_result_msg(data.player1Roll, data.player2Roll);

    await updateDoc(doc(db, "rooms", "room1"), {
      result: result
    });
  }
  document.getElementById("result").innerText = render(data);
});

// ユーザー状態監視
onAuthStateChanged(auth, async (user) => {
  isAuthChecked = true;

  if (user) {
    uid = user.uid;
    console.log("UID:", uid);

    // Firestoreから名前取得
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      playerName = userDoc.data().name;
    } else if (playerName) {
      // 新規登録直後
      await setDoc(doc(db, "users", uid), {
        name: playerName
      });
    }

    // const roomRef = doc(db, "rooms", "room1");
    // const roomSnap = await getDoc(roomRef);
    // const data = roomSnap.data();

    // if (!data) {
    //   console.log("firestoreにデータ無し");
    //   return;
    // }

    // if (!data.player1) {
    //   console.log("player1として登録: " + uid);
    //   await updateDoc(roomRef, { player1: uid });
    // } else if (!data.player2) {
    //   console.log("player2として登録: " + uid);
    //   await updateDoc(roomRef, { player2: uid });
    // }

    // if (data.player1 === uid || data.player2 === uid) {
    //   return;
    // }
  }
});