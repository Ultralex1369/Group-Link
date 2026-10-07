import { app } from "./firebase-config.js";

import {
    getAuth,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

import {
    getFirestore,
    collection,
    doc,
    getDocs,
    setDoc,
    deleteDoc,
    writeBatch,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

// These MUST match GROUP_LEN / MEMBER_LEN in app.js
const GROUP_LEN = 4;
const MEMBER_LEN = 4;

// No 0/O or 1/I so codes are easy to read out loud
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const $ = (id) => document.getElementById(id);


// ---------- helpers ----------

function randomCode(length) {
    let out = "";
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
    return out;
}

function uniqueCode(length, used) {
    let code;
    do {
        code = randomCode(length);
    } while (used.has(code));
    used.add(code);
    return code;
}

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
}


// ---------- sign in / out ----------

$("signInBtn").onclick = async () => {

    $("authError").textContent = "";

    try {
        await signInWithEmailAndPassword(
            auth,
            $("emailInput").value.trim(),
            $("passwordInput").value
        );
    } catch (err) {
        $("authError").textContent = "Couldn't sign in.";
    }
};

$("passwordInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("signInBtn").click();
});

$("signOutBtn").onclick = () => signOut(auth);

onAuthStateChanged(auth, (user) => {

    $("adminLogin").style.display = user ? "none" : "flex";
    $("adminPanel").style.display = user ? "flex" : "none";

    if (user) loadGroups();
});


// ---------- loading + showing groups ----------

async function loadGroups() {

    $("panelError").textContent = "";

    const list = $("groupList");
    list.replaceChildren();

    try {

        const groupSnap = await getDocs(collection(db, "groups"));

        const groups = [];

        for (const g of groupSnap.docs) {
            const memberSnap = await getDocs(collection(db, "groups", g.id, "members"));
            groups.push({
                code: g.id,
                name: g.data().name,
                members: memberSnap.docs.map((m) => ({ code: m.id, name: m.data().name }))
            });
        }

        groups.sort((a, b) => a.name.localeCompare(b.name));

        if (groups.length === 0) {
            list.append(el("div", { textContent: "No groups yet." }));
        }

        groups.forEach((g) => list.append(renderGroup(g)));

    } catch (err) {
        console.error(err);
        $("panelError").textContent =
            "Not allowed. Is this account set as the admin in your Firestore rules?";
    }
}

function renderGroup(group) {

    const card = el("div", { className: "card" });

    card.append(el("h3", { textContent: group.name + "  (" + group.code + ")" }));

    group.members.forEach((m) => {

        const removeBtn = el("button", { className: "small danger", textContent: "Remove" });

        removeBtn.onclick = async () => {
            if (!confirm("Remove " + m.name + " from " + group.name + "?")) return;
            await deleteDoc(doc(db, "groups", group.code, "members", m.code));
            loadGroups();
        };

        card.append(el("div", { className: "row" },
            el("span", { textContent: m.name }),
            el("span", { className: "code", textContent: group.code + "-" + m.code }),
            removeBtn
        ));
    });

    // add a member
    const nameInput = el("input", { placeholder: "New member name", maxLength: 30 });
    const addBtn = el("button", { className: "small", textContent: "Add" });

    addBtn.onclick = async () => {

        const name = nameInput.value.trim();
        if (!name) return;

        const used = new Set(group.members.map((m) => m.code));
        const code = uniqueCode(MEMBER_LEN, used);

        await setDoc(doc(db, "groups", group.code, "members", code), { name });
        loadGroups();
    };

    card.append(el("div", { className: "inline" }, nameInput, addBtn));

    // delete the whole group
    const deleteBtn = el("button", { className: "small danger", textContent: "Delete group" });

    deleteBtn.onclick = async () => {
        if (!confirm("Delete " + group.name + " and ALL its messages? This can't be undone.")) return;
        deleteBtn.disabled = true;
        await deleteGroup(group.code);
        loadGroups();
    };

    card.append(deleteBtn);

    return card;
}


// ---------- creating a group ----------

$("createBtn").onclick = async () => {

    const groupName = $("groupNameInput").value.trim();

    const names = $("memberNamesInput").value
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean);

    if (!groupName || names.length === 0) {
        $("createError").textContent = "Add a group name and at least one member.";
        return;
    }

    $("createBtn").disabled = true;
    $("createError").textContent = "";

    try {

        // find a group code nobody uses yet
        const existing = new Set((await getDocs(collection(db, "groups"))).docs.map((d) => d.id));
        const groupCode = uniqueCode(GROUP_LEN, existing);

        const used = new Set();
        const batch = writeBatch(db);

        batch.set(doc(db, "groups", groupCode), {
            name: groupName,
            createdAt: serverTimestamp()
        });

        names.forEach((name) => {
            const code = uniqueCode(MEMBER_LEN, used);
            batch.set(doc(db, "groups", groupCode, "members", code), { name });
        });

        await batch.commit();

        $("groupNameInput").value = "";
        $("memberNamesInput").value = "";

        loadGroups();

    } catch (err) {
        console.error(err);
        $("createError").textContent = "Couldn't create the group.";
    }

    $("createBtn").disabled = false;
};


// ---------- deleting a group ----------

async function deleteSubcollection(path) {

    const snap = await getDocs(collection(db, ...path));

    // batches are limited to 500 writes
    for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
    }
}

async function deleteGroup(groupCode) {
    await deleteSubcollection(["groups", groupCode, "messages"]);
    await deleteSubcollection(["groups", groupCode, "members"]);
    await deleteDoc(doc(db, "groups", groupCode));
}
