import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

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