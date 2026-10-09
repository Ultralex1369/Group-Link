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
    updateDoc,
    deleteDoc,
    writeBatch,
    serverTimestamp,
    query,
    orderBy,
    limitToLast,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

// New groups/members get 2-digit codes (01-99), so a login code is 4 digits: GROUP + MEMBER.
// Older groups with 4-character codes are still supported.

// Old-style codes (only used when adding people to an older group)
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const $ = (id) => document.getElementById(id);

let groups = [];            // [{ code, name }]
let selected = null;        // group code currently open, or null
let stopChat = null;        // unsubscribe function for the open chat


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

// Picks a free 2-digit code from 01-99 (null if all 99 are taken)
function pickCode(used) {

    const free = [];

    for (let i = 1; i <= 99; i++) {
        const c = String(i).padStart(2, "0");
        if (!used.has(c)) free.push(c);
    }

    if (free.length === 0) return null;

    const pick = free[crypto.getRandomValues(new Uint32Array(1))[0] % free.length];
    used.add(pick);
    return pick;
}

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
}

function placeholder(text) {
    return el("div", { className: "placeholder", textContent: text });
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

    if (user) {
        showNothing();
        loadGroups();
    } else {
        closeChat();
        selected = null;
    }
});


// ---------- left: list of groups ----------

async function loadGroups() {

    $("panelError").textContent = "";

    try {

        const snap = await getDocs(collection(db, "groups"));

        groups = snap.docs
            .map((d) => ({ code: d.id, name: d.data().name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        renderGroupList();

    } catch (err) {
        console.error(err);
        $("panelError").textContent =
            "Not allowed. Is this account set as the admin in your Firestore rules?";
    }
}

function renderGroupList() {

    const list = $("groupList");
    list.replaceChildren();

    if (groups.length === 0) {
        list.append(placeholder("No groups yet"));
        return;
    }

    groups.forEach((g) => {

        const item = el("div",
            { className: "groupItem" + (g.code === selected ? " active" : "") },
            el("span", { textContent: g.name }),
            el("span", { className: "gcode", textContent: g.code })
        );

        item.onclick = () => selectGroup(g.code);

        list.append(item);
    });
}

$("newGroupBtn").onclick = showNewGroup;


// ---------- nothing / new group / selected group ----------

function closeChat() {
    if (stopChat) stopChat();
    stopChat = null;
}

function showNothing() {
    closeChat();
    selected = null;
    $("chatPane").replaceChildren(placeholder("Pick a group to read its chat"));
    $("controlPane").replaceChildren();
    renderGroupList();
}

function showNewGroup() {

    closeChat();
    selected = null;
    renderGroupList();

    $("chatPane").replaceChildren(placeholder("Pick a group to read its chat"));

    const nameInput = el("input", { placeholder: "Group name", maxLength: 30 });
    const membersInput = el("textarea", {
        rows: 6,
        maxLength: 600,
        placeholder: "Member names (one per line)"
    });
    const error = el("div", { className: "error" });
    const createBtn = el("button", { textContent: "Create" });

    createBtn.onclick = async () => {

        const groupName = nameInput.value.trim();

        const names = membersInput.value
            .split("\n")
            .map((n) => n.trim())
            .filter(Boolean);

        if (!groupName || names.length === 0) {
            error.textContent = "Add a group name and at least one member.";
            return;
        }

        if (names.length > 99) {
            error.textContent = "A group can have at most 99 members.";
            return;
        }

        createBtn.disabled = true;
        error.textContent = "";

        try {

            const used = new Set(groups.map((g) => g.code));
            const groupCode = pickCode(used);

            if (!groupCode) {
                error.textContent = "All 99 group codes are in use.";
                createBtn.disabled = false;
                return;
            }

            const memberCodes = new Set();
            const batch = writeBatch(db);

            batch.set(doc(db, "groups", groupCode), {
                name: groupName,
                createdAt: serverTimestamp()
            });

            names.forEach((name) => {
                const code = pickCode(memberCodes);
                batch.set(doc(db, "groups", groupCode, "members", code), { name });
            });

            await batch.commit();

            await loadGroups();
            selectGroup(groupCode);

        } catch (err) {
            console.error(err);
            error.textContent = "Couldn't create the group.";
            createBtn.disabled = false;
        }
    };

    $("controlPane").replaceChildren(
        el("h3", { textContent: "New group" }),
        nameInput,
        membersInput,
        error,
        createBtn
    );
}

function selectGroup(code) {

    selected = code;
    renderGroupList();

    openChat(code);
    renderControls(code);
}


// ---------- middle: read-only chat ----------

function openChat(code) {

    closeChat();

    const group = groups.find((g) => g.code === code);

    const container = el("div", { id: "messages" });

    $("chatPane").replaceChildren(
        el("h2", { textContent: group ? group.name : "" }),
        container
    );

    let first = true;

    const q = query(
        collection(db, "groups", code, "messages"),
        orderBy("time"),
        limitToLast(200)
    );

    stopChat = onSnapshot(q, (snapshot) => {

        // keep the view pinned to the bottom unless you scrolled up to read
        const nearBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < 60;

        const frag = document.createDocumentFragment();

        snapshot.forEach((d) => {

            const message = d.data();

            const wrapper = el("div", { className: "message theirs" });
            const sender = el("div", { textContent: message.sender });
            const text = el("div", { textContent: message.text });
            const time = el("div");

            if (message.time) {
                time.textContent = message.time.toDate().toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit"
                });
            }

            const del = el("button", { className: "msgDelete", textContent: "delete" });

            del.onclick = async () => {
                if (!confirm("Delete this message for everyone?")) return;
                await deleteDoc(d.ref);
            };

            wrapper.append(sender, text, time, del);
            frag.appendChild(wrapper);
        });

        container.replaceChildren(frag);

        if (first || nearBottom) container.scrollTop = container.scrollHeight;
        first = false;

    }, (err) => {
        console.error(err);
        container.replaceChildren(placeholder("Couldn't load this chat."));
    });
}


// ---------- right: controls for the open group ----------

async function renderControls(code) {

    const group = groups.find((g) => g.code === code);
    if (!group) return;

    const pane = $("controlPane");
    pane.replaceChildren(placeholder("Loading..."));

    let members;

    try {
        const snap = await getDocs(collection(db, "groups", code, "members"));
        members = snap.docs.map((m) => ({ code: m.id, name: m.data().name }));
    } catch (err) {
        console.error(err);
        pane.replaceChildren(placeholder("Couldn't load members."));
        return;
    }

    // you may have clicked another group while this was loading
    if (selected !== code) return;

    members.sort((a, b) => a.name.localeCompare(b.name));

    // title + rename
    const renameBtn = el("button", { className: "small secondary", textContent: "Rename" });

    renameBtn.onclick = async () => {
        const name = prompt("New group name:", group.name);
        if (!name || !name.trim()) return;
        await updateDoc(doc(db, "groups", code), { name: name.trim().slice(0, 30) });
        await loadGroups();
        selectGroup(code);
    };

    pane.replaceChildren(
        el("div", { className: "inline" },
            el("h3", { textContent: group.name, style: "flex:1" }),
            renameBtn
        )
    );

    // members
    members.forEach((m) => {

        const editBtn = el("button", { className: "small secondary", textContent: "Edit" });
        const removeBtn = el("button", { className: "small danger", textContent: "X" });

        editBtn.onclick = async () => {
            const name = prompt("New name:", m.name);
            if (!name || !name.trim()) return;
            await updateDoc(doc(db, "groups", code, "members", m.code), {
                name: name.trim().slice(0, 30)
            });
            renderControls(code);
        };

        removeBtn.onclick = async () => {
            if (!confirm("Remove " + m.name + " from " + group.name + "?")) return;
            await deleteDoc(doc(db, "groups", code, "members", m.code));
            renderControls(code);
        };

        pane.append(el("div", { className: "row" },
            el("span", { className: "name", textContent: m.name }),
            el("span", { className: "code", textContent: code + "-" + m.code }),
            editBtn,
            removeBtn
        ));
    });

    // add member
    const nameInput = el("input", { placeholder: "New member name", maxLength: 30 });
    const addBtn = el("button", { className: "small", textContent: "Add" });

    addBtn.onclick = async () => {

        const name = nameInput.value.trim();
        if (!name) return;

        const used = new Set(members.map((m) => m.code));
        // older groups (4-character code) keep 4-character member codes
        const memberCode = code.length === 2 ? pickCode(used) : uniqueCode(4, used);

        if (!memberCode) {
            alert("This group already has 99 members.");
            return;
        }

        await setDoc(doc(db, "groups", code, "members", memberCode), { name });
        renderControls(code);
    };

    nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addBtn.click();
    });

    pane.append(el("div", { className: "inline" }, nameInput, addBtn));

    // delete group
    const deleteBtn = el("button", { className: "small danger", textContent: "Delete group" });

    deleteBtn.onclick = async () => {
        if (!confirm("Delete " + group.name + " and ALL its messages? This can't be undone.")) return;
        deleteBtn.disabled = true;
        closeChat();
        await deleteGroup(code);
        await loadGroups();
        showNothing();
    };

    pane.append(deleteBtn);
}


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
