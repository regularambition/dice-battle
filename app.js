// Firebase読み込み
import { db, auth } from "./firebase.js";
import {
  doc,
  updateDoc,
  onSnapshot,
  where,
  getDoc,
  setDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let uid = null;
let currentRoomData = null;
let isAuthChecked = false;
let isRoomListenerRunning = false;
let playerName = null;
let myWaitingDocId = null;
let currentRoomId = null;

const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));//timeはミリ秒

function showScreen(screenId) {
  const screens = ["screen-title", "screen-name", "screen-menu", "screen-random-match-waiting", "screen-game"];

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

  if (uid) {
    // 既存ユーザー
    showScreen("screen-menu");
  } else {
    // 新規ユーザー
    showScreen("screen-name");
  }
};

document.getElementById("nameSubmit").onclick = async () => {
  if (uid) {
    alert("既に登録済です");
    return;
  }

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
  const max_valid_length = 12;
  if (name.length > max_valid_length) {
    alert(max_valid_length + "文字以内で入力してください");
    return;
  }

  playerName = name;

  try {
    await signInAnonymously(auth);
  } catch (e) {
    console.error(e);
  }

  showScreen("screen-menu");
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
// document.getElementById("rollBtn").onclick = async () => {
//   if (!uid || !currentRoomData) {
//     alert("まだ初期化されていません");
//     return;
//   }
//   if (!currentRoomData.player1 || !currentRoomData.player2) {
//     alert("まだ対戦相手がいません");
//     return;
//   }
//   if (!(currentRoomData.player1 === uid || currentRoomData.player2 === uid)) {
//     alert("このルームの参加者ではありません");
//     return;
//   }

//   const roll = Math.floor(Math.random() * 6) + 1;

//   const roomRef = doc(db, "rooms", "room1");

//   if (currentRoomData.player1 === uid) {
//     if (currentRoomData.player1Roll == null) {
//       await updateDoc(roomRef, {
//         player1Roll: roll
//       });
//     } else {
//       alert("player1は既にサイコロを振っています");
//       return;
//     }
//   } else {
//     if (currentRoomData.player2Roll == null) {
//       await updateDoc(roomRef, {
//         player2Roll: roll
//       });
//     } else {
//       alert("player2は既にサイコロを振っています");
//       return;
//     }
//   }
// };

// リアルタイム監視
// onSnapshot(doc(db, "rooms", "room1"), async (docSnap) => {
//   const data = docSnap.data();
//   currentRoomData = data;

//   if (data.player1Roll && data.player2Roll && !data.result) {
//     const result = get_result_msg(data.player1Roll, data.player2Roll);

//     await updateDoc(doc(db, "rooms", "room1"), {
//       result: result
//     });
//   }
//   document.getElementById("result").innerText = render(data);
// });

// ユーザー状態監視
onAuthStateChanged(auth, async (user) => {
  if (user) {
    uid = user.uid;
    console.log("UID:", uid);

    if (!isRoomListenerRunning) {
      console.log(uid + "をキーとする部屋の監視を開始");
      startRoomListener();
      isRoomListenerRunning = true;
    }

    // Firestoreから名前取得
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      // 既存ユーザー
      playerName = userDoc.data().name;
    } else if (playerName) {
      // 新規登録直後
      await setDoc(doc(db, "users", uid), {
        name: playerName
      });
    }
    if (playerName) {
      document.getElementById("playerName").innerText =
        `プレイヤー名：${playerName}`;
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

  if (!isAuthChecked) {
    isAuthChecked = true;
  }
});

async function joinQueue() {
  // ① 自分を待機キューに追加
  const docRef = await addDoc(collection(db, "waiting"), {
    uid: uid,
    createdAt: Date.now()
  });
  // 待機キュー内において自分のUIDを保持しているドキュメントIDを保持
  myWaitingDocId = docRef.id;

  // ② 待機キュー取得
  const q = query(collection(db, "waiting"), orderBy("createdAt"));
  const snapshot = await getDocs(q);

  // ③ 2人以上ならマッチング
  if (snapshot.size >= 2) {
    const users = snapshot.docs.slice(0, 2);

    const uid1 = users[0].data().uid;
    const uid2 = users[1].data().uid;

    // ④ room作成
    const roomRef = await addDoc(collection(db, "rooms"), {
      players: [uid1, uid2],
      player1: uid1,
      player2: uid2,
      player1Roll: null,
      player2Roll: null,
      result: null
    });

    // ⑤ waiting削除
    for (const docSnap of users) {
      await deleteDoc(doc(db, "waiting", docSnap.id));
    }

    console.log("マッチング成功:", roomRef.id);
  }
}

async function leaveQueue() {
  await deleteDoc(doc(db, "waiting", myWaitingDocId));
}

document.getElementById("randomBtn").onclick = async () => {
  await joinQueue();
  showScreen("screen-random-match-waiting");
};

document.getElementById("randomMatchCancelBtn").onclick = async () => {
  if (!myWaitingDocId) {
    alert("マッチング相手待機状態ではありません");
    return;
  }

  try {
    await leaveQueue();
  } catch (e) {
    alert("waiting削除失敗");
    return;
  }
  myWaitingDocId = null;
  showScreen("screen-menu");
};

function startRoomListener() {
  const roomQuery = query(
    collection(db, "rooms"),
    where("players", "array-contains", uid)
  );

  onSnapshot(roomQuery, (snapshot) => {
    snapshot.forEach((docSnap) => {
      const room = docSnap.data();

      // ★ すでに入っているなら無視（重複防止）
      if (currentRoomId) {
        return;
      }

      console.log("マッチ成立:", docSnap.id);

      currentRoomId = docSnap.id;

      // ★ waitingから削除（まだ残ってた場合）
      if (myWaitingDocId) {
        try {
          leaveQueue();
        } catch (e) {
          console.log("waiting削除失敗（問題なし）");
        }
        myWaitingDocId = null;
      }

      document.getElementById("randomMatchWaitingNotification").innerText =
        `相手が見つかりました。3秒後に対戦が始まります`;
      sleep(3000);
      document.getElementById("randomMatchWaitingNotification").innerText = ``;

      // ★ ゲーム画面へ
      showScreen("screen-game");

      // ★ UI表示更新
      document.getElementById("roomId").innerText =
        `Room: ${currentRoomId}`;
    });
  });
}