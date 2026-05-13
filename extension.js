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

