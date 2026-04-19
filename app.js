// Firebase読み込み
import { db, auth } from "./firebase.js";
import { room_states } from "./room_state_enum.js";
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
let playerName = null;
let myWaitingDocId = null;
let currentRoomId = null;
let unsubscribeRoomListener = null;
let unsubscribeGameListener = null;
let isRematchChoiceFixed = true;
let heartBeatId = null;
let displayRematchUiId = null;
let delta = 0;

// timeはミリ秒
const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));

const heartBeatIntervalMilliSec = 3000;
const disconnectionIntervalMilliSec = 10000;
const rematchDeadlineMilliSec = 20000;
const rematchRemainingTimeIntervalMilliSec = 1000;
const reconnectDurationMilliSec = 15000;

function quitIntervalRepeating(id) {
  if (id != null) {
    clearInterval(id);
  }
}

// 部屋に入っている状態であれば一定の時間間隔で
// 通信中であることをFirestoreに通知する
async function heartBeat() {
  if (!currentRoomId) {
    return;
  }
  console.log("heartBeatが呼ばれました");

  const roomRef = doc(db, "rooms", currentRoomId);

  updateDoc(roomRef, {
    [`lastSeen.${myUid}`]: Date.now()
  });
}

// 一定時間以上更新なしの場合に切断したと判定する
function isDisconnected(lastSeen) {
  const now = Date.now() - delta;
  return now - lastSeen >= disconnectionIntervalMilliSec;
}

function displayRematchUi() {
  if (!currentRoomData || !currentRoomData?.rematchDeadline) {
    return;
  }
  console.log("displayRematchUiが呼ばれました");

  const now = Date.now();
  const remaining = Math.max(0, currentRoomData.rematchDeadline - now);
  document.getElementById("rematchRemainingTime").textContent = `${Math.ceil(remaining / rematchRemainingTimeIntervalMilliSec)}`;
}

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
    alert(`${max_valid_length}文字以内で入力してください`);
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

function get_result_msg(myRoll, opponentRoll) {
  if (myRoll > opponentRoll) {
    return "YOU WIN!!!";
  } else if (myRoll < opponentRoll) {
    return "you lose...";
  } else {
    return "draw";
  }
}

function render(data) {
  const myRoll = (data.player1 === myUid) ? data.player1Roll : data.player2Roll;
  const opponentRoll = (data.player1 === myUid) ? data.player2Roll : data.player1Roll;
  const opponentName = document.getElementById("opponentName").textContent;

  if (myRoll != null && opponentRoll != null) {
    const rematchArea = document.getElementById("rematchArea");
    if (rematchArea.style.display === "none") {
      isRematchChoiceFixed = false;
      rematchArea.style.display = "block";
      console.log("再戦希望選択部分を表示しました（最初の1回のみ実行されるはず）");
    }

    const result = get_result_msg(myRoll, opponentRoll);
    return `you: ${myRoll}, ${opponentName}: ${opponentRoll} -> ${result}`;
  } else {
    return `you: ${myRoll ?? "waiting"}, ${opponentName}: ${opponentRoll ?? "waiting"}`;
  }
}

// ボタン操作
document.getElementById("rollBtn").onclick = async () => {
  if (!currentRoomId || !currentRoomData || currentRoomData.state != room_states.playing) {
    alert("部屋が初期化されていません");
    return;
  }

  const roll = Math.floor(Math.random() * 6) + 1;

  const roomRef = doc(db, "rooms", currentRoomId);

  if (myUid === currentRoomData.player1) {
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

document.getElementById("rematchBtn").onclick = async () => {
  if (isRematchChoiceFixed) {
    console.log(`既に選択済みまたは再戦・解散が決定済みです`);
    return;
  }
  isRematchChoiceFixed = true;

  const roomRef = doc(db, "rooms", currentRoomId);
  updateDoc(roomRef, {
    [`rematch.${myUid}`]: true
  });
};

document.getElementById("leaveBtn").onclick = async () => {
  if (isRematchChoiceFixed) {
    console.log(`既に選択済みまたは再戦・解散が決定済みです`);
    return;
  }
  isRematchChoiceFixed = true;

  const roomRef = doc(db, "rooms", currentRoomId);
  updateDoc(roomRef, {
    [`rematch.${myUid}`]: false
  });
};

async function fetchUserDocByUid(arg_uid) {
  return await getDoc(doc(db, "users", arg_uid));
}

async function fetchRoomDocById(arg_roomId) {
  return await getDoc(doc(db, "rooms", arg_roomId));
}

function isReconnectionExpired(roomDoc) {
  if (!roomDoc.exists()) {
    return true;
  }
  if (roomDoc.data().state === room_states.closed || roomDoc.data().state === room_states.rematch_wait) {
    return true;
  }
  if (roomDoc.data().reconnectExpireAt == null) {
    return false;
  }
  const opponentId = getOpponentIdFromRoomData(roomDoc.data());

  // 再接続期限時刻は相手の端末が記録しているため真の経過時間に直す
  delta = roomDoc.data().enteredAt?.[myUid] - roomDoc.data().enteredAt?.[opponentId];
  return roomDoc.data().reconnectExpireAt - (Date.now() - delta) <= reconnectDurationMilliSec;
}

// ユーザー状態監視
onAuthStateChanged(auth, async (user) => {
  if (user) {
    myUid = user.uid;
    console.log("UID:", myUid);

    // Firestoreから名前取得
    const userDoc = await fetchUserDocByUid(myUid);
    if (userDoc.exists()) {
      // 既存ユーザー
      playerName = userDoc.data().name;

      // 再接続する時の処理
      if (userDoc.data().currentRoomId) {
        currentRoomId = userDoc.data().currentRoomId;

        const roomDoc = await fetchRoomDocById(currentRoomId);
        if (isReconnectionExpired(roomDoc)) {
          console.log(`再接続期限切れのため${currentRoomId}入室不可能`);
          updateDoc(doc(db, "users", myUid), {
            currentRoomId: null
          });
          currentRoomId = null;
        } else {
          console.log(`${currentRoomId}へ再接続します`);
          await updateDoc(doc(db, "rooms", currentRoomId), {
            [`lastSeen.${myUid}`]: Date.now(),
            state: room_states.playing,
            reconnectExpireAt: null
          });
          heartBeatId = setInterval(heartBeat, heartBeatIntervalMilliSec);
          displayRematchUiId = setInterval(displayRematchUi, rematchRemainingTimeIntervalMilliSec);
          startGameListener(currentRoomId);
          showScreen("screen-game");
        }
      }
    } else if (playerName) {
      // 新規登録直後
      await setDoc(doc(db, "users", myUid), {
        name: playerName
      });
    }
    if (playerName) {
      document.getElementById("playerName").textContent = `${playerName}`;
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
      lastSeen: {
        [uid1]: null,
        [uid2]: null
      },
      enteredAt: {
        [uid1]: null,
        [uid2]: null
      },
      rematch: {},
      rematchDeadline: null,
      state: room_states.not_started_yet
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
  startRoomListener();
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
  stopRoomListener();
  showScreen("screen-menu");
};

function getOpponentIdFromRoomData(roomData) {
  if (roomData.player1 === myUid) {
    return roomData.player2;
  } else {
    return roomData.player1;
  }
}

function startRoomListener() {
  if (unsubscribeRoomListener) {
    return;
  }
  console.log("roomListener起動成功");

  const roomQuery = query(
    collection(db, "rooms"),
    where("players", "array-contains", myUid),
    where("state", "==", room_states.not_started_yet)
  );

  unsubscribeRoomListener = onSnapshot(roomQuery, async (snapshot) => {
    snapshot.forEach(async (docSnap) => {
      console.log("roomListenerが呼ばれました");

      // ★ すでに入っているなら無視（重複防止）
      if (currentRoomId) {
        console.log("既に入室済みのためroomListenerが即座に終了しました");
        return;
      }

      console.log("マッチ成立:", docSnap.id);

      currentRoomId = docSnap.id;
      updateDoc(doc(db, "users", myUid), {
        currentRoomId: currentRoomId
      });

      // ★ waitingから削除（まだ残ってた場合）
      if (myWaitingDocId) {
        try {
          await leaveQueue();
        } catch (e) {
          console.log("waiting削除失敗（問題なし）");
        }
        myWaitingDocId = null;
      }

      heartBeatId = setInterval(heartBeat, heartBeatIntervalMilliSec);
      displayRematchUiId = setInterval(displayRematchUi, rematchRemainingTimeIntervalMilliSec);

      document.getElementById("randomMatchWaitingNotification").textContent =
        `相手が見つかりました。3秒後に対戦が始まります`;
      await sleep(3000);
      document.getElementById("randomMatchWaitingNotification").textContent = ``;

      // 入った部屋の情報を保持しているFirestoreドキュメントをリアルタイム監視
      startGameListener(currentRoomId);

      // ★ ゲーム画面へ
      showScreen("screen-game");

      // ★ マッチ成立したら監視停止
      stopRoomListener();
    });
  });
}

function stopRoomListener() {
  if (unsubscribeRoomListener) {
    unsubscribeRoomListener();
    unsubscribeRoomListener = null;
    console.log("roomListener停止成功");
  }
}

function cannotReconnectAnyLonger(reconnectExpireAt) {
  return Date.now() >= reconnectExpireAt;
}

function startGameListener(roomId) {
  if (unsubscribeGameListener) {
    return;
  }
  console.log("gameListener起動成功");
  const roomRef = doc(db, "rooms", roomId);

  unsubscribeGameListener = onSnapshot(roomRef, async (docSnap) => {
    console.log("gameListenerが呼ばれました");

    const data = docSnap.data();
    currentRoomData = data;

    // UI更新
    const opponentId = getOpponentIdFromRoomData(data);
    const opponentLastSeen = data.lastSeen?.[opponentId];
    if (document.getElementById("roomId").textContent.length === 0) {
      document.getElementById("roomId").textContent = `${roomId}`;
      const opponentDoc = await fetchUserDocByUid(opponentId);
      document.getElementById("opponentName").textContent = `${opponentDoc.data().name}`;

      console.log("roomId, opponentNameのUI表示完了（最初の1回のみ実行されるはず）");
    }
    document.getElementById("result").textContent = render(data);

    if (data.state === room_states.not_started_yet) {
      if (data.enteredAt?.[myUid] == null) {
        await updateDoc(roomRef, {
          [`enteredAt.${myUid}`]: Date.now()
        });
      }
      if (data.enteredAt?.[myUid] != null && data.enteredAt?.[opponentId] != null) {
        delta = data.enteredAt?.[myUid] - data.enteredAt?.[opponentId];

        if (myUid === data.player1) {
          await updateDoc(roomRef, {
            state: room_states.playing
          });
        }
      }
    } else if (data.state === room_states.playing) {
      if (isDisconnected(opponentLastSeen)) {
        // 切断時の扱い
        document.getElementById("opponentConnectionNotification").textContent = "相手の接続が切れました";

        // 再接続してくる側と競合しないように2倍の値を設定（再接続許可時間は本来の値）
        await updateDoc(roomRef, {
          state: room_states.reconnect_wait,
          reconnectExpireAt: Date.now() + 2 * reconnectDurationMilliSec
        });
      } else {
        document.getElementById("opponentConnectionNotification").textContent = "";
      }

      if (myUid === data.player1 && data.player1Roll != null && data.player2Roll != null) {
        await updateDoc(roomRef, {
          state: room_states.rematch_wait,
          rematch: {},
          rematchDeadline: Date.now() + rematchDeadlineMilliSec
        });
      }
    } else if (data.state === room_states.reconnect_wait) {
      console.log(`残り時間 = ${data.reconnectExpireAt - Date.now()} msec`);
      if (cannotReconnectAnyLonger(data.reconnectExpireAt)) {
        console.log("切断後の再接続期限切れのため強制解散");
        currentRoomData.player1 = myUid;
        await bye(roomId, currentRoomData);
        return;
      }
    } else if (data.state === room_states.rematch_wait) {
      if (isDisconnected(opponentLastSeen)) {
        console.log("相手が再戦希望選択中に接続を切ったため強制解散");
        currentRoomData.player1 = myUid;
        await bye(roomId, currentRoomData);
        return;
      }

      let now = Date.now();
      if (myUid === data.player2) {
        now -= delta;
      }
      if (now >= data.rematchDeadline) {
        // 選択肢が表示されてから一定時間が経過すると強制解散
        console.log("再戦希望選択時間切れのため強制解散");
        await bye(roomId, data);
        return;
      }

      const rematch = data.rematch;
      const myChoice = rematch[myUid];
      const opponentChoice = rematch[opponentId];

      // 状態表示
      document.getElementById("rematchStatus").textContent =
        `あなた: ${myChoice ?? "未選択"} / 相手: ${opponentChoice ?? "未選択"}`;

      if (myChoice == null) {
        if (opponentChoice === false) {
          // 解散
          await bye(roomId, data);
        } else {
          console.log("まだ二人の再戦選択が揃っていません");
        }
      } else if (myChoice) {
        if (opponentChoice == null) {
          console.log("まだ二人の再戦選択が揃っていません");
        } else if (opponentChoice) {
          // 再戦
          if (myUid === data.player1) {
            await updateDoc(roomRef, {
              player1Roll: null,
              player2Roll: null,
              state: room_states.playing,
              rematch: {},
              rematchDeadline: null
            });
          }

          console.log("二人とも再戦を希望しました");

          document.getElementById("rematchStatus").textContent =
            `再戦が希望されたため3秒後に開始されます`;
          await sleep(3000);
          document.getElementById("rematchStatus").textContent = ``;
          document.getElementById("rematchArea").style.display = "none";
        } else {
          // 解散
          await bye(roomId, data);
        }
      } else {
        // 解散
        await bye(roomId, data);
      }
    } else if (data.state === room_states.closed) {
      currentRoomData.player1 = "";
      await bye(roomId, currentRoomData);
    }
  });
}

// 再戦を希望しない時の解散処理
async function bye(roomId, roomData) {
  isRematchChoiceFixed = true;
  await updateDoc(doc(db, "users", myUid), {
    currentRoomId: null
  });

  quitIntervalRepeating(heartBeatId);
  quitIntervalRepeating(displayRematchUiId);
  heartBeatId = null;
  displayRematchUiId = null;

  await stopGameListener(roomId, (myUid === roomData.player1));
  document.getElementById("rematchStatus").textContent =
    `再戦が希望されなかったため3秒後にメニュー画面へ戻ります`;
  await sleep(3000);
  document.getElementById("roomId").textContent = ``;
  document.getElementById("rematchStatus").textContent = ``;
  document.getElementById("rematchArea").style.display = "none";

  currentRoomId = null;
  currentRoomData = null;

  showScreen("screen-menu");
}

async function stopGameListener(roomId, isRoomRemover) {
  if (unsubscribeGameListener) {
    unsubscribeGameListener();
    unsubscribeGameListener = null;

    if (isRoomRemover) {
      await updateDoc(doc(db, "rooms", roomId), {
        state: room_states.closed
      });
      console.log(`部屋${roomId}の削除成功`);
    }
    console.log("gameListener停止成功");
  }
}
