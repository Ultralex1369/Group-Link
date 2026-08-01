import { sendMessage, listenForMessages } from "./firebase.js";


const CODES = {
    "1111": "Alex",
    "2222": "Sam",
    "3333": "Jordan",
    "4444": "You"
};


let currentUser = "";


const continueBtn = document.getElementById("continueBtn");


continueBtn.onclick = () => {

    const code = document.getElementById("codeInput").value;


    if (CODES[code]) {

        currentUser = CODES[code];

    } else {

        alert("Wrong Code");
        return;

    }


   document.getElementById("loginScreen").style.display = "none";

document.getElementById("chatScreen").style.display = "flex";

document.getElementById("welcomeText").textContent =
    "Welcome, " + currentUser;

loadMessages();

};



const sendBtn = document.getElementById("sendBtn");


sendBtn.onclick = async () => {

    const input = document.getElementById("messageInput");

    await sendMessage(currentUser, input.value);

    input.value = "";

};



function loadMessages() {

    listenForMessages((messages) => {

        const container = document.getElementById("messages");

        container.innerHTML = "";


        messages.forEach((message) => {

            const wrapper = document.createElement("div");

            wrapper.classList.add("message");


            const sender = document.createElement("div");
            const text = document.createElement("div");
            const time = document.createElement("div");


            if (message.sender === currentUser) {

    wrapper.classList.add("mine");

    sender.textContent = "You";

} else {

    wrapper.classList.add("theirs");

    sender.textContent = message.sender;

}


            text.textContent = message.text;


            if (message.time) {

                const date = message.time.toDate();

                time.textContent = date.toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit"
                });

            }


            wrapper.appendChild(sender);
            wrapper.appendChild(text);
            wrapper.appendChild(time);


            container.appendChild(wrapper);
            container.scrollTop = container.scrollHeight;

        });

    });

}