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

let myUid = null;
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

  if (myUid) {
    // 既存ユーザー
    showScreen("screen-menu");
  } else {
    // 新規ユーザー
    showScreen("screen-name");
  }
};

document.getElementById("nameSubmit").onclick = async () => {
  if (myUid) {
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
  if (data.player1Roll != null && data.player2Roll != null) {
    const result = get_result_msg(data.player1Roll, data.player2Roll);
    return `P1: ${data.player1Roll}, P2: ${data.player2Roll} -> ${result}`;
  } else {
    return `P1: ${data.player1Roll ?? "waiting"}, P2: ${data.player2Roll ?? "waiting"}`;
  }
}

// ボタン操作
document.getElementById("rollBtn").onclick = async () => {
  if (!currentRoomId || !currentRoomData) {
    alert("部屋が初期化されていません");
    return;
  }

  const roll = Math.floor(Math.random() * 6) + 1;

  const roomRef = doc(db, "rooms", currentRoomId);

  if (currentRoomData.player1 === myUid) {
    if (currentRoomData.player1Roll == null) {
      await updateDoc(roomRef, {
        player1Roll: roll
      });
    } else {
      alert("既にサイコロを振っています");
      return;
    }
  } else {
    if (currentRoomData.player2Roll == null) {
      await updateDoc(roomRef, {
        player2Roll: roll
      });
    } else {
      alert("既にサイコロを振っています");
      return;
    }
  }
};

async function fetchUserDocByUid(arg_uid) {
  return await getDoc(doc(db, "users", arg_uid));
}

// ユーザー状態監視
onAuthStateChanged(auth, async (user) => {
  if (user) {
    myUid = user.uid;
    console.log("UID:", myUid);

    if (!isRoomListenerRunning) {
      console.log(myUid + "をキーとする部屋の監視を開始");
      startRoomListener();
      isRoomListenerRunning = true;
    }

    // Firestoreから名前取得
    const userDoc = await fetchUserDocByUid(myUid);
    if (userDoc.exists()) {
      // 既存ユーザー
      playerName = userDoc.data().name;
    } else if (playerName) {
      // 新規登録直後
      await setDoc(doc(db, "users", myUid), {
        name: playerName
      });
    }
    if (playerName) {
      document.getElementById("playerName").innerText =
        `プレイヤー名：${playerName}`;
    }
  }

  if (!isAuthChecked) {
    isAuthChecked = true;
  }
});

async function joinQueue() {
  // ① 自分を待機キューに追加
  const docRef = await addDoc(collection(db, "waiting"), {
    uid: myUid,
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
  showScreen("screen-random-match-waiting");
  await joinQueue();
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
    where("players", "array-contains", myUid)
  );

  onSnapshot(roomQuery, async (snapshot) => {
    snapshot.forEach(async (docSnap) => {
      // ★ すでに入っているなら無視（重複防止）
      if (currentRoomId) {
        return;
      }

      console.log("マッチ成立:", docSnap.id);

      // 入った部屋の情報を保持しているFirestoreドキュメントをリアルタイム監視
      currentRoomId = docSnap.id;
      startGameListener(currentRoomId);

      // ★ waitingから削除（まだ残ってた場合）
      if (myWaitingDocId) {
        try {
          await leaveQueue();
        } catch (e) {
          console.log("waiting削除失敗（問題なし）");
        }
        myWaitingDocId = null;
      }

      document.getElementById("randomMatchWaitingNotification").innerText =
        `相手が見つかりました。3秒後に対戦が始まります`;
      await sleep(3000);
      document.getElementById("randomMatchWaitingNotification").innerText = ``;

      // ★ UI表示更新
      document.getElementById("roomId").innerText =
        `Room: ${currentRoomId}`;
      const room = docSnap.data();
      const opponentId = (room.player1 === myUid) ? room.player2 : room.player1;
      const opponentDoc = await fetchUserDocByUid(opponentId);
      document.getElementById("opponentName").innerText =
        `相手の名前：${opponentDoc.data().name}`;

      // ★ ゲーム画面へ
      showScreen("screen-game");
    });
  });
}

function startGameListener(roomId) {
  const roomRef = doc(db, "rooms", roomId);

  onSnapshot(roomRef, async (docSnap) => {
    const data = docSnap.data();
    currentRoomData = data;

    // 勝敗確定
    if (data.player1Roll != null && data.player2Roll != null && !data.result) {
      const result = get_result_msg(data.player1Roll, data.player2Roll);
      await updateDoc(roomRef, { result });
    }

    // UI更新
    document.getElementById("result").innerText = render(data);
  });
}