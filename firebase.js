import { app } from "./firebase-config.js";

import {
    getFirestore,
    collection,
    doc,
    getDoc,
    addDoc,
    serverTimestamp,
    query,
    orderBy,
    limitToLast,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const db = getFirestore(app);

/*
  Database layout:

  groups/{groupCode}                      -> { name, createdAt }
  groups/{groupCode}/members/{memberCode} -> { name }
  groups/{groupCode}/messages/{autoId}    -> { sender, senderId, text, time }
*/

// ---------- Logging in ----------

export async function getGroup(groupCode) {
    const snap = await getDoc(doc(db, "groups", groupCode));
    return snap.exists() ? snap.data() : null;
}

export async function getMember(groupCode, memberCode) {
    const snap = await getDoc(doc(db, "groups", groupCode, "members", memberCode));
    return snap.exists() ? snap.data() : null;
}


// ---------- Messages ----------

export async function sendMessage(groupCode, senderId, senderName, text) {

    text = text.trim();
    if (!text) return;

    await addDoc(collection(db, "groups", groupCode, "messages"), {
        sender: senderName,
        senderId: senderId,
        text: text,
        time: serverTimestamp()
    });
}


// Returns an "unsubscribe" function so you can stop listening (logout)
export function listenForMessages(groupCode, callback) {

    const q = query(
        collection(db, "groups", groupCode, "messages"),
        orderBy("time"),
        limitToLast(200)
    );

    return onSnapshot(q, (snapshot) => {

        const messages = [];

        snapshot.forEach((d) => {
            messages.push({ id: d.id, ...d.data() });
        });

        callback(messages);
    });
}
