// Firebase読み込み
import { db, auth } from "./firebase.js";
import { room_states } from "./room_state_enum.js";
import { room_modes } from "./room_mode_enum.js";
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
  deleteDoc,
  serverTimestamp,
  runTransaction
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
let timeOffset = 0;
let myPrivateRoomId = null;

// timeはミリ秒
const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));

const regex = /^[A-Za-z0-9]+$/;

const heartBeatIntervalMilliSec = 3000;
const disconnectionIntervalMilliSec = 10000;
const rematchDurationMilliSec = 20000;
const rematchRemainingTimeIntervalMilliSec = 1000;
const reconnectDurationMilliSec = 15000;

function cannotCallToMillis(arg) {
  return !arg || !arg.toMillis;
}

/**
 * 入室時あるいは再接続時に呼び出してサーバー・ローカル間の時刻オフセットを取得
 */
async function syncServerTime() {
  const dummyRef = doc(db, "current_dummy", "2pHQMjO9Q6NSL8wfogoR");
  const before = Date.now();

  // ① サーバー時刻を書き込む
  await updateDoc(dummyRef, {
    serverTime: serverTimestamp()
  });

  // ② 1回だけ待つリスナー
  return new Promise((resolve) => {
    const unsubscribe = onSnapshot(dummyRef, (snap) => {
      const data = snap.data();
      const ts = data?.serverTime;

      if (cannotCallToMillis(ts)) {
        return;
      }

      const serverTime = ts.toMillis();
      const after = Date.now();

      // ③ RTT補正
      const latency = (after - before) / 2;

      // ④ offset計算
      timeOffset = serverTime - (before + latency);

      console.log("offset:", timeOffset);

      unsubscribe();
      resolve();
    });
  });
}

/**
 * 予め求めておいた時刻オフセットを用いて擬似的なサーバー時刻を取得する
 */
function getNow() {
  const res = Date.now() + timeOffset;
  return res;
}

function quitIntervalRepeating(id) {
  if (id != null) {
    clearInterval(id);
  }
}

/**
 * 部屋に入っている状態であれば一定の時間間隔で
 * 通信中であることをFirestoreに通知する
 */
async function heartBeat() {
  if (!currentRoomId) {
    return;
  }

  const roomRef = getRoomRef(currentRoomId);

  updateDoc(roomRef, {
    [`lastSeen.${myUid}`]: serverTimestamp()
  });
}

/**
 * 相手が一定時間以上更新なしの場合に切断したと判定する
 */
function isDisconnected(opponentLastSeen) {
  if (cannotCallToMillis(opponentLastSeen)) {
    return false;
  }

  const olsMsec = opponentLastSeen.toMillis();
  return getNow() - olsMsec >= disconnectionIntervalMilliSec;
}

function displayRematchUi() {
  if (!currentRoomData || cannotCallToMillis(currentRoomData?.gameEndedAt)) {
    return;
  }

  const remaining = Math.max(0, currentRoomData.gameEndedAt.toMillis() + rematchDurationMilliSec - getNow());
  document.getElementById("rematchRemainingTime").textContent = `${Math.ceil(remaining / rematchRemainingTimeIntervalMilliSec)}`;
}

function showScreen(screenId) {
  const screens = [
    "screen-title", "screen-name", "screen-menu", "screen-random-match-waiting", "screen-game",
    "screen-private-match-choice", "screen-private-match-host", "screen-private-match-guest"
  ];

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

  if (!regex.test(name)) {
    alert("大文字・小文字・アラビア数字のみが利用できます");
    return;
  }
  const max_valid_length = 12;
  if (name.length > max_valid_length) {
    alert(`${max_valid_length}文字以内で入力してください`);
    return;
  }

  if (!confirm(`名前を${name}として登録してよろしいですか？`)) {
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

  const roomRef = getRoomRef(currentRoomId);

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

  const roomRef = getRoomRef(currentRoomId);
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

  const roomRef = getRoomRef(currentRoomId);
  updateDoc(roomRef, {
    [`rematch.${myUid}`]: false
  });
};

async function fetchUserDocByUid(arg_uid) {
  return await getDoc(doc(db, "users", arg_uid));
}

function getRoomRef(roomId) {
  return doc(db, "rooms", roomId);
}

/**
 * 時間が経過して再接続できなくなっている場合にtrueを返す
 */
function isReconnectionExpired(roomDoc) {
  if (!roomDoc.exists()) {
    return true;
  }
  if (roomDoc.data().state === room_states.closed || roomDoc.data().state === room_states.rematch_wait) {
    return true;
  }
  if (cannotCallToMillis(roomDoc.data().disconnectDetectedAt)) {
    return false;
  }
  return getNow() - roomDoc.data().disconnectDetectedAt.toMillis() >= reconnectDurationMilliSec;
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

        const roomRef = getRoomRef(currentRoomId);
        const roomDoc = await getDoc(roomRef);
        await syncServerTime();
        if (isReconnectionExpired(roomDoc)) {
          console.log(`再接続期限切れのため${currentRoomId}入室不可能`);
          updateDoc(doc(db, "users", myUid), {
            currentRoomId: null
          });

          if (roomDoc.exists() && roomDoc.data().state === room_states.rematch_wait) {
            console.log(`部屋の状態が${room_states.rematch_wait}であるため要削除か確認`);
            await sleep(disconnectionIntervalMilliSec);

            const rdc = await getDoc(roomRef);
            if (rdc.exists() && rdc.data().state === room_states.rematch_wait) {
              console.log(`部屋削除を実行`);
              await updateDoc(roomRef, {
                state: room_states.closed
              });
            }
          }
          currentRoomId = null;
        } else {
          console.log(`${currentRoomId}へ再接続します`);
          await updateDoc(roomRef, {
            [`lastSeen.${myUid}`]: serverTimestamp(),
            state: room_states.playing,
            disconnectDetectedAt: null
          });

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
    createdAt: serverTimestamp()
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
      rematch: {},
      gameEndedAt: null,
      disconnectDetectedAt: null,
      state: room_states.preprocessing
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
  startRoomListener("randomMatchWaitingNotification");
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

function startRoomListener(notificationComponentId) {
  if (unsubscribeRoomListener) {
    return;
  }
  console.log("roomListener起動成功");

  const roomQuery = query(
    collection(db, "rooms"),
    where(`participants.${myUid}`, "==", true),
    where("state", "==", room_states.waiting_for_entrace)
  );

  unsubscribeRoomListener = onSnapshot(roomQuery, async (snapshot) => {
    snapshot.forEach(async (docSnap) => {
      if (!currentRoomId) {
        console.log("マッチ成立:", docSnap.id);
        currentRoomId = docSnap.id;
        updateDoc(doc(db, "users", myUid), {
          currentRoomId: currentRoomId
        });
      }

      const data = docSnap.data();
      console.log(`called onSnapshot in startRoomListener: state = ${data.state}`);
      const roomRef = getRoomRef(currentRoomId);
      if (data.state === room_states.waiting_for_entrace) {
        if (myUid === data.player1 && data.player2 != null) {
          await updateDoc(roomRef, {
            state: room_states.preprocessing
          });
        }
      } else if (data.state === room_states.preprocessing) {
        // ★ waitingから削除（まだ残ってた場合）
        if (myWaitingDocId) {
          try {
            await leaveQueue();
          } catch (e) {
            console.log("waiting削除失敗（問題なし）");
          }
          myWaitingDocId = null;
        }

        await syncServerTime();

        document.getElementById(notificationComponentId).textContent =
          `相手が見つかりました。3秒後に対戦が始まります`;
        await sleep(3000);
        document.getElementById(notificationComponentId).textContent = ``;

        // 入った部屋の情報を保持しているFirestoreドキュメントをリアルタイム監視
        startGameListener(currentRoomId);

        // ★ ゲーム画面へ
        showScreen("screen-game");

        // ★ マッチ成立したら監視停止
        stopRoomListener();
      }
    });
  });
}

function stopRoomListener() {
  if (unsubscribeRoomListener) {
    unsubscribeRoomListener();
    unsubscribeRoomListener = null;
    myPrivateRoomId = null;
    console.log("roomListener停止成功");
  }
}

/**
 * 相手の切断から一定時間が経過して再接続受付をやめなければならない場合にtrueを返す
 */
function mustEndReconnectionGracePeriod(disconnectDetectedAt) {
  if (cannotCallToMillis(disconnectDetectedAt)) {
    return false;
  }
  const ddat = disconnectDetectedAt.toMillis();
  return getNow() - ddat >= 2 * reconnectDurationMilliSec;
}

/**
 * 再戦希望選択の提示から一定時間が経過して再戦受付をやめなければならない場合にtrueを返す
 */
function mustEndRematchGracePeriod(gameEndedAt) {
  if (cannotCallToMillis(gameEndedAt)) {
    return false;
  }
  const geat = gameEndedAt.toMillis();
  return getNow() - geat >= rematchDurationMilliSec;
}

function startGameListener(roomId) {
  if (unsubscribeGameListener) {
    return;
  }
  console.log("gameListener起動成功");
  const roomRef = getRoomRef(roomId);

  unsubscribeGameListener = onSnapshot(roomRef, async (docSnap) => {
    const data = docSnap.data();
    currentRoomData = data;

    console.log(`called onSnapshot in startGameListener: state = ${data.state}`);

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

    if (data.state === room_states.preprocessing) {
      if (data.lastSeen?.[myUid] != null && data.lastSeen?.[opponentId] != null) {
        console.log(`二人とも入室完了したためゲーム開始`);

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

        await updateDoc(roomRef, {
          state: room_states.reconnect_wait,
          disconnectDetectedAt: serverTimestamp()
        });
      } else {
        document.getElementById("opponentConnectionNotification").textContent = "";
      }

      if (myUid === data.player1 && data.player1Roll != null && data.player2Roll != null) {
        await updateDoc(roomRef, {
          state: room_states.rematch_wait,
          rematch: {},
          gameEndedAt: serverTimestamp()
        });
      }
    } else if (data.state === room_states.reconnect_wait) {
      if (!cannotCallToMillis(data.disconnectDetectedAt)) {
        console.log(`残り時間 = ${data.disconnectDetectedAt.toMillis() + 2 * reconnectDurationMilliSec - getNow()} msec`);
      }
      if (mustEndReconnectionGracePeriod(data.disconnectDetectedAt)) {
        console.log("切断後の再接続期限切れのため強制解散");
        currentRoomData.player1 = myUid;
        await bye(roomId, currentRoomData);
        return;
      }
    } else if (data.state === room_states.rematch_wait) {
      if (mustEndRematchGracePeriod(data.gameEndedAt)) {
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
              gameEndedAt: null
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

  heartBeatId = setInterval(heartBeat, heartBeatIntervalMilliSec);
  displayRematchUiId = setInterval(displayRematchUi, rematchRemainingTimeIntervalMilliSec);
}

// 解散処理
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
    `試合が終了したため3秒後にメニュー画面へ戻ります`;
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
      const roomRef = getRoomRef(roomId);
      await updateDoc(roomRef, {
        state: room_states.closed
      });
      console.log(`部屋${roomId}の削除成功`);
    }
    console.log("gameListener停止成功");
  }
}

/**
 * プライベートマッチ部屋を建てる
 */
async function createPrivateRoom() {
  const roomRef = await addDoc(collection(db, "rooms"), {
    mode: room_modes.private,
    participants: {
      [myUid]: true
    },
    player1: myUid,
    player2: null,
    player1Roll: null,
    player2Roll: null,
    lastSeen: {},
    rematch: {},
    gameEndedAt: null,
    disconnectDetectedAt: null,
    state: room_states.waiting_for_entrace
  });

  myPrivateRoomId = roomRef.id;
  document.getElementById("myPrivateRoomId").textContent = myPrivateRoomId;
  startRoomListener("privateMatchHostWaitingNotification");
}

/**
 * 建てたプライベートマッチ部屋への入室受付をやめる
 */
async function quitWaitingForEntrace() {
  if (!myPrivateRoomId) {
    alert(`プライベートマッチ部屋を建てていません`);
    return;
  }

  const roomRef = getRoomRef(myPrivateRoomId);

  try {
    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);

      if (roomSnap.exists()) {
        const data = roomSnap.data();
        if (data.state !== room_states.waiting_for_entrace) {
          alert(`既に入室が確定しています`);
          return;
        }
        transaction.update(roomRef, {
          state: room_states.closed
        });
      } else {
        console.log(`部屋${myPrivateRoomId}が消失済み`);
      }
    });

    console.log("入室受付を停止しました");
    stopRoomListener();
  } catch (e) {
    alert(e.message);
  }
}

/**
 * ホストの建てたプライベートマッチ部屋のIDを入力して入る
 */
async function joinByRoomId(roomId) {
  const roomRef = getRoomRef(roomId);

  try {
    await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);

      if (!roomSnap.exists()) {
        throw new Error("部屋が存在しません");
      }

      const data = roomSnap.data();

      if (data.state !== room_states.waiting_for_entrace) {
        throw new Error("満員です");
      }

      if (data.player1 === myUid || data.player2 === myUid) {
        console.log("既に入室済み");
        return;
      }

      if (data.mode !== room_modes.private) {
        throw new Error("不正な部屋");
      }

      transaction.update(roomRef, {
        player2: myUid,
        [`participants.${myUid}`]: true
      });
    });

    console.log("入室成功");
    startRoomListener("privateMatchGuestWaitingNotification");

  } catch (e) {
    alert(e.message);
  }
}

document.getElementById("privateBtn").onclick = () => {
  showScreen("screen-private-match-choice");
};

document.getElementById("privateHostBtn").onclick = async () => {
  await createPrivateRoom();
  document.getElementById("privateMatchHostWaitingNotification").textContent = "";
  showScreen("screen-private-match-host");
};

document.getElementById("myPrivateRoomIdCopyBtn").onclick = async () => {
  if (!navigator.clipboard) {
    alert("このブラウザはコピー機能に対応していません");
  }

  const input = document.getElementById("myPrivateRoomId").textContent;
  const notification = document.getElementById("privateMatchHostWaitingNotification");
  try {
    await navigator.clipboard.writeText(input);
    notification.textContent = "コピーしました！";
  } catch (err) {
    console.error(err);
    notification.textContent = "コピーに失敗しました";
  }
};

document.getElementById("privateHostCancelBtn").onclick = async () => {
  await quitWaitingForEntrace();
  showScreen("screen-private-match-choice");
};

document.getElementById("privateGuestBtn").onclick = async () => {
  showScreen("screen-private-match-guest");
};

document.getElementById("privateRoomIdInputConfirmBtn").onclick = async () => {
  const roomId = document.getElementById("privateRoomIdInput").value;
  if (!regex.test(roomId)) {
    alert("大文字・小文字・アラビア数字のみが利用できます");
    return;
  }
  await joinByRoomId(roomId);
};

document.getElementById("privateGuestCancelBtn").onclick = async () => {
  showScreen("screen-private-match-choice");
};

document.getElementById("privateCancelBtn").onclick = async () => {
  showScreen("screen-menu");
};
