
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

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

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Get a reference to the database service and export it
export const db = getDatabase(app);

// Get a reference to the auth service and export it
export const auth = getAuth(app);

