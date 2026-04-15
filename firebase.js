// CDNから読み込み
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBes-X0j9vjfAucM6h5Mc24-HHvsTiVWz4",
  authDomain: "browser-game-sample.firebaseapp.com",
  databaseURL: "https://browser-game-sample-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "browser-game-sample",
  storageBucket: "browser-game-sample.firebasestorage.app",
  messagingSenderId: "88857414316",
  appId: "1:88857414316:web:899aeb382a740c56682d09"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);