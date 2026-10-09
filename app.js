import {
    getGroup,
    getMember,
    sendMessage,
    listenForMessages
} from "./firebase.js";


// A full code is 4 digits: GROUP (2 digits) + MEMBER (2 digits), e.g. 12 + 05 = 1205.
// Older 8-character codes (4 + 4) still work too, so existing groups keep running.

const SAVE_KEY = "groupLinkSession";

const $ = (id) => document.getElementById(id);

let session = null;        // { groupCode, memberCode, name, groupName }
let stopListening = null;


// ---------- helpers ----------

function parseCode(raw) {

    const clean = raw.replace(/[^a-z0-9]/gi, "").toUpperCase();

    let groupLen;

    if (clean.length === 4) groupLen = 2;          // new style: 12-05
    else if (clean.length === 8) groupLen = 4;     // old style: 7KQ2-M4XB
    else return null;

    return {
        groupCode: clean.slice(0, groupLen),
        memberCode: clean.slice(groupLen)
    };
}

function formatCode(groupCode, memberCode) {
    return groupCode + "-" + memberCode;
}

function show(screenId) {
    ["loginScreen", "chatScreen"].forEach((id) => {
        $(id).style.display = (id === screenId) ? "flex" : "none";
    });
}

function setError(message) {
    $("loginError").textContent = message || "";
}


// ---------- login ----------

async function login(rawCode) {

    const parsed = parseCode(rawCode);

    if (!parsed) {
        setError("Codes are 4 digits.");
        return false;
    }

    try {

        const group = await getGroup(parsed.groupCode);
        const member = group && await getMember(parsed.groupCode, parsed.memberCode);

        if (!group || !member) {
            setError("Wrong code");
            return false;
        }

        session = {
            groupCode: parsed.groupCode,
            memberCode: parsed.memberCode,
            name: member.name,
            groupName: group.name
        };

    } catch (err) {
        console.error(err);
        setError("Couldn't connect. Try again.");
        return false;
    }

    localStorage.setItem(SAVE_KEY, parsed.groupCode + parsed.memberCode);
    setError("");
    enterChat();
    return true;
}

function enterChat() {

    show("chatScreen");

    $("welcomeText").textContent = "Welcome, " + session.name;
    $("groupTitle").textContent = session.groupName;

    $("messages").innerHTML = "";

    stopListening = listenForMessages(session.groupCode, renderMessages);
}

function logout() {

    if (stopListening) stopListening();
    stopListening = null;
    session = null;

    localStorage.removeItem(SAVE_KEY);

    $("codeInput").value = "";
    show("loginScreen");
}

$("continueBtn").onclick = () => login($("codeInput").value);

$("codeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login($("codeInput").value);
});

$("logoutBtn").onclick = logout;


// ---------- messages ----------

async function send() {

    const input = $("messageInput");
    const text = input.value;

    if (!text.trim() || !session) return;

    input.value = "";
    $("sendBtn").disabled = true;

    try {
        await sendMessage(session.groupCode, session.memberCode, session.name, text);
    } catch (err) {
        console.error(err);
        input.value = text;   // give the text back if it failed
    }

    $("sendBtn").disabled = false;
    input.focus();
}

$("sendBtn").onclick = send;

$("messageInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
});


function renderMessages(messages) {

    const container = $("messages");
    const frag = document.createDocumentFragment();

    messages.forEach((message) => {

        const wrapper = document.createElement("div");
        const sender = document.createElement("div");
        const text = document.createElement("div");
        const time = document.createElement("div");

        wrapper.classList.add("message");

        if (message.senderId === session.memberCode) {
            wrapper.classList.add("mine");
            sender.textContent = "You";
        } else {
            wrapper.classList.add("theirs");
            sender.textContent = message.sender;
        }

        text.textContent = message.text;

        // time is empty for a split second while the server stamps it
        if (message.time) {
            time.textContent = message.time.toDate().toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit"
            });
        }

        wrapper.append(sender, text, time);
        frag.appendChild(wrapper);
    });

    container.replaceChildren(frag);
    container.scrollTop = container.scrollHeight;
}


// ---------- stay logged in ----------

const saved = localStorage.getItem(SAVE_KEY);

if (saved) login(saved);
