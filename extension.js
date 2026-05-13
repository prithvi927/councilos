const axios = require('axios');
const vscode = require('vscode');

function activate(context) {
     console.log("🔥 EXTENSION ACTIVATED");
    let disposable = vscode.commands.registerCommand(
        'council.start',
        function () {

            const editor = vscode.window.activeTextEditor;

            let selectedText = "";

            if (editor) {
                const selection = editor.selection;
                selectedText = editor.document.getText(selection);
            }

            const panel = vscode.window.createWebviewPanel(
                'theCouncil',
                'The Council',
                vscode.ViewColumn.Two,
                { enableScripts: true }
            );

            panel.webview.onDidReceiveMessage(

                async message => {
                    if (message.command === "webviewReady") {
                        panel.webview.postMessage({
                            command: "setCode",
                            data: selectedText
                        });
                    }
                    if (message.command === "startCouncil") {

            // Step 1: Show loading
                    

                    try {
                // Step 2: Call backend
                            console.log("Sending request to backend...");
                            console.log("Starting streaming...");

                        const response = await axios.post(
                            "http://localhost:3000/debate-stream",
                            { code: selectedText },
                            { responseType: "stream" }
                        );

                        const stream = response.data;

                        stream.on("data", chunk => {

                            const parts = chunk.toString().split("\n\n");

                            for (let part of parts) {

                                const line = part.replace("data: ", "").trim();

                                if (!line) continue;

                                try {

                                    const msg = JSON.parse(line);

                                    if (msg.command === "discussionFinished") {
                                        panel.webview.postMessage({
                                            command: "discussionFinished"
                                        });

                                    } else {
                                        panel.webview.postMessage({
                                            command: "appendMessage",
                                            data: msg
                                    });
                                }

                                } catch (err) {
                                    console.log("Parse error:", err);
                                }
                            }
                        });


                    } catch (error) {
                        console.log("ERROR:", error);
                        }
                    }
                },
                
                undefined,
                context.subscriptions
            );

            const fs = require("fs");
            const path = require("path");

            const distPath = path.join(context.extensionPath, "webview-ui", "dist");
            let html = fs.readFileSync(path.join(distPath, "index.html"), "utf8");

            // 🔥 FIX asset paths
            html = html.replace(/(src|href)="\/(.*?)"/g, (match, type, file) => {
                const filePath = vscode.Uri.file(path.join(distPath, file));
                const webviewUri = panel.webview.asWebviewUri(filePath);
                return `${type}="${webviewUri}"`;
            });
            
            html = html.replace(
                "<body>",
                `<body>
                <script>
                    const vscode = acquireVsCodeApi();
                    window.vscode = vscode;
                </script>`
            );

            panel.webview.html = html;

            
    });

    context.subscriptions.push(disposable);
}


function getWebviewContent(selectedCode = "", status = "") {
    return `<!DOCTYPE html>
    <html>
    <head>
        <style>
            body {
                background: #0a0a0f;
                color: #ffffff;
                font-family: monospace;
                padding: 20px;
            }
            h1 { color: #7c3aed; }


        button {
            background: #7c3aed;
            color: white;
            border: none;
            padding: 10px 20px;
            margin: 10px 0;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
        }

        button:hover {
            background: #5b21b6;
            }

        pre {
            background: #1a1a2e;
            padding: 15px;
            border-radius: 8px;
            color: #00ff88;
            white-space: pre-wrap;
        }
        
        .status {
            margin-top: 10px;
            color: #facc15;
            }

        
        .chat {
            margin-top: 20px;
            display: flex;
            flex-direction: column;
            }

        .message {
            padding: 12px;
            border-radius: 10px;
            margin: 10px 0;
            max-width: 80%;
            white-space: pre-wrap;
        }

        .architect {
            background: #2e1065;
            color: #c4b5fd;
            align-self: flex-start;
        }

        .critic {
            background: #7f1d1d;
            color: #fecaca;
            align-self: flex-end;
}

        </style>
    </head>
    <body>
        <h1>⚔️ THE COUNCIL</h1>
        <p>powered by VERDICT</p>
        <button onclick="startCouncil()">⚔️ Start Council</button>
        <p>Selected code:</p>
        <pre>${selectedCode || "Nothing selected"}</pre>

        <div class="chat">
            ${status}
        </div>

        <script>
            const vscode = acquireVsCodeApi();

            function startCouncil() {
                const chat = document.querySelector(".chat");
                chat.innerHTML = "Analyzing your code...";
        
                vscode.postMessage({
                    command: "startCouncil"
                });
            }

            window.addEventListener("message", event => {
                const msg = event.data;

                if (msg.command === "appendMessage") {
                    appendMessage(msg.data);
                }
            });

            function appendMessage(data) {
                const chat = document.querySelector(".chat");

                const div = document.createElement("div");

                div.className = "message " + 
                    (data.agent === "Architect" ? "architect" : "critic");

                div.innerHTML = "<b>" + data.agent + "</b><br/>" + data.content;

                chat.appendChild(div);

                chat.scrollTop = chat.scrollHeight;
            }
        </script>

    </body>
    </html>`;
}

function deactivate() {}


module.exports = { activate, deactivate };