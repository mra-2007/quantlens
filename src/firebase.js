import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDFPD82KXYMmdf3iRNhlhKzB3R4bGXGYqc",
  authDomain: "ventureiq-7661e.firebaseapp.com",
  projectId: "ventureiq-7661e",
  storageBucket: "ventureiq-7661e.firebasestorage.app",
  messagingSenderId: "558263541616",
  appId: "1:558263541616:web:953cf411b14177e49939b5",
};

const app = initializeApp(firebaseConfig);

// 🔥 THIS IS IMPORTANT (for login/signup)
export const auth = getAuth(app);