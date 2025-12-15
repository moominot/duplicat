import firebase from "firebase/compat/app";
import "firebase/compat/database";

// Configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBpmcsNinXdrg7hx_XLVU7A1uKfJwY9TfI",
  authDomain: "duplicada-15dd5.firebaseapp.com",
  // IMPORTANT: Aquesta URL és necessària per a Realtime Database.
  databaseURL: "https://duplicada-15dd5-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "duplicada-15dd5",
  storageBucket: "duplicada-15dd5.firebasestorage.app",
  messagingSenderId: "831532666384",
  appId: "1:831532666384:web:c9d02cb6176d3ff5b5c495"
};

// Initialize Firebase (Compat)
const app = !firebase.apps.length ? firebase.initializeApp(firebaseConfig) : firebase.app();
export const db = app.database();