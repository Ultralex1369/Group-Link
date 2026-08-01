import { app } from "./firebase-config.js";

import {
    getFirestore,
    collection,
    addDoc,
    serverTimestamp,
    query,
    orderBy,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const db = getFirestore(app);

const messagesRef = collection(db, "messages");


export async function sendMessage(sender, text) {

    if (!text.trim()) return;

    await addDoc(messagesRef, {
        sender: sender,
        text: text,
        time: serverTimestamp()
    });

}


export function listenForMessages(callback) {

    const q = query(messagesRef, orderBy("time"));

    onSnapshot(q, (snapshot) => {

        const messages = [];

        snapshot.forEach((doc) => {

            messages.push({
                id: doc.id,
                ...doc.data()
            });

        });

        callback(messages);

    });

}