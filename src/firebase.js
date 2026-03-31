// src/firebase.js
// Import the functions you need from the SDKs
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA2EbvBlum9kQV2MFk9BXcm37HOlenrFaQ",
  authDomain: "you-and-me-chat-af98e.firebaseapp.com",
  projectId: "you-and-me-chat-af98e",
  storageBucket: "you-and-me-chat-af98e.appspot.com",
  messagingSenderId: "483619152453",
  appId: "1:483619152453:web:0e680748182a22e861792c",
  databaseURL: "https://you-and-me-chat-af98e-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Realtime Database
export const db = getDatabase(app);

// Storage
export const storage = getStorage(app);