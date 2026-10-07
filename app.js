import {
    getGroup,
    getMember,
    sendMessage,
    listenForMessages
} from "./firebase.js";


// A full code is GROUP part + MEMBER part, e.g. 7KQ2 + M4XB = 7KQ2M4XB
// Longer group part = harder for strangers to guess.
const GROUP_LEN = 4;
const MEMBER_LEN = 4;

const SAVE_KEY = "groupLinkSession";

const $ = (id) => document.getElementById(id);

let session = null;        // { groupCode, memberCode, name, groupName }
let stopListening = null;


// ---------- helpers ----------

function parseCode(raw) {

    const clean = raw.replace(/[^a-z0-9]/gi, "").toUpperCase();

    if (clean.length !== GROUP_LEN + MEMBER_LEN) return null;

    return {
        groupCode: clean.slice(0, GROUP_LEN),
        memberCode: clean.slice(GROUP_LEN)
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
        setError("Codes are " + (GROUP_LEN + MEMBER_LEN) + " characters.");
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
