import { IS_PUTER } from "./puter.js";
import { toggleThemeMode } from "./ui.js";
import { getChatResponse } from "./ai-service.js";

const API_KEY = ""; // Get yours at https://platform.sulu.sh/apis/judge0

const AUTH_HEADERS = API_KEY ? {
    "Authorization": `Bearer ${API_KEY}`
} : {};

const CE = "CE";
const EXTRA_CE = "EXTRA_CE";

const AUTHENTICATED_CE_BASE_URL = "https://judge0-ce.p.sulu.sh";
const AUTHENTICATED_EXTRA_CE_BASE_URL = "https://judge0-extra-ce.p.sulu.sh";

var AUTHENTICATED_BASE_URL = {};
AUTHENTICATED_BASE_URL[CE] = AUTHENTICATED_CE_BASE_URL;
AUTHENTICATED_BASE_URL[EXTRA_CE] = AUTHENTICATED_EXTRA_CE_BASE_URL;

const UNAUTHENTICATED_CE_BASE_URL = "https://ce.judge0.com";
const UNAUTHENTICATED_EXTRA_CE_BASE_URL = "https://extra-ce.judge0.com";

var UNAUTHENTICATED_BASE_URL = {};
UNAUTHENTICATED_BASE_URL[CE] = UNAUTHENTICATED_CE_BASE_URL;
UNAUTHENTICATED_BASE_URL[EXTRA_CE] = UNAUTHENTICATED_EXTRA_CE_BASE_URL;

const INITIAL_WAIT_TIME_MS = 0;
const WAIT_TIME_FUNCTION = i => 100;
const MAX_PROBE_REQUESTS = 50;

var fontSize = 13;

var layout;

var sourceEditor;
var stdinEditor;
var stdoutEditor;
var assistantEditor;

var $selectLanguage;
var $compilerOptions;
var $commandLineArguments;
var $runBtn;
var $statusLine;

var timeStart;

var sqliteAdditionalFiles;
var languages = {};

var layoutConfig = {
    settings: {
        showPopoutIcon: false,
        reorderEnabled: true
    },
    content: [{
        type: "row",
        content: [{
            type: "column",
            width: 66,
            content: [{
                type: "component",
                componentName: "source",
                id: "source",
                title: "Source Code",
                isClosable: false,
                componentState: {
                    readOnly: false
                }
            }, {
                type: "component",
                componentName: "assistant",
                id: "assistant",
                title: "Code Assistant",
                height: 30,
                isClosable: false,
                componentState: {
                    readOnly: false
                }
            }]
        }, {
            type: "column",
            content: [{
                type: "component",
                componentName: "stdin",
                id: "stdin",
                title: "Input",
                isClosable: false,
                componentState: {
                    readOnly: false
                }
            }, {
                type: "component",
                componentName: "stdout",
                id: "stdout",
                title: "Output",
                isClosable: false,
                componentState: {
                    readOnly: true
                }
            }]
        }]
    }]
};

var gPuterFile;

let currentModel = 'mixtral-8x7b-32768';
let availableModels = {};

const AVAILABLE_MODELS = {
    // Groq Models
    'groq/mixtral-8x7b-32768': {
        name: 'Mixtral 8x7B',
        description: 'Powerful open-source model with large 32K context window',
        context_length: 32768,
        provider: 'groq',
        default: false
    },
    'groq/deepseek-r1-distill-llama-70b': {
        name: 'DeepSeek R1 Distill LLaMA 70B (Think Tags Removed)',
        description: 'DeepSeek R1 Distill LLaMA 70B',
        context_length: 32768,
        provider: 'groq',
        default: true
    },
    // OpenRouter Models
    'anthropic/claude-3-haiku': {
        name: 'Claude 3 Haiku',
        description: 'Fast and efficient Claude model',
        context_length: 4096,
        provider: 'openrouter',
        default: false
    }
};

function encode(str) {
    return btoa(unescape(encodeURIComponent(str || "")));
}

function decode(bytes) {
    var escaped = escape(atob(bytes || ""));
    try {
        return decodeURIComponent(escaped);
    } catch {
        return unescape(escaped);
    }
}

function showError(title, content) {
    $("#judge0-site-modal #title").html(title);
    $("#judge0-site-modal .content").html(content);

    let reportTitle = encodeURIComponent(`Error on ${window.location.href}`);
    let reportBody = encodeURIComponent(
        `**Error Title**: ${title}\n` +
        `**Error Timestamp**: \`${new Date()}\`\n` +
        `**Origin**: ${window.location.href}\n` +
        `**Description**:\n${content}`
    );

    $("#report-problem-btn").attr("href", `https://github.com/judge0/ide/issues/new?title=${reportTitle}&body=${reportBody}`);
    $("#judge0-site-modal").modal("show");
}

function showHttpError(jqXHR) {
    showError(`${jqXHR.statusText} (${jqXHR.status})`, `<pre>${JSON.stringify(jqXHR, null, 4)}</pre>`);
}

function handleRunError(jqXHR) {
    showHttpError(jqXHR);
    $runBtn.removeClass("disabled");

    window.top.postMessage(JSON.parse(JSON.stringify({
        event: "runError",
        data: jqXHR
    })), "*");
}

function handleResult(data) {
    const tat = Math.round(performance.now() - timeStart);
    console.log(`It took ${tat}ms to get submission result.`);

    const status = data.status;
    const stdout = decode(data.stdout);
    const compileOutput = decode(data.compile_output);
    const time = (data.time === null ? "-" : data.time + "s");
    const memory = (data.memory === null ? "-" : data.memory + "KB");

    $statusLine.html(`${status.description}, ${time}, ${memory} (TAT: ${tat}ms)`);

    const output = [compileOutput, stdout].join("\n").trim();

    stdoutEditor.setValue(output);

    $runBtn.removeClass("disabled");

    window.top.postMessage(JSON.parse(JSON.stringify({
        event: "postExecution",
        status: data.status,
        time: data.time,
        memory: data.memory,
        output: output
    })), "*");
}

async function getSelectedLanguage() {
    return getLanguage(getSelectedLanguageFlavor(), getSelectedLanguageId())
}

function getSelectedLanguageId() {
    return parseInt($selectLanguage.val());
}

function getSelectedLanguageFlavor() {
    return $selectLanguage.find(":selected").attr("flavor");
}

function run() {
    if (sourceEditor.getValue().trim() === "") {
        showError("Error", "Source code can't be empty!");
        return;
    } else {
        $runBtn.addClass("disabled");
    }

    stdoutEditor.setValue("");
    $statusLine.html("");

    let x = layout.root.getItemsById("stdout")[0];
    x.parent.header.parent.setActiveContentItem(x);

    let sourceValue = encode(sourceEditor.getValue());
    let stdinValue = encode(stdinEditor.getValue());
    let languageId = getSelectedLanguageId();
    let compilerOptions = $compilerOptions.val();
    let commandLineArguments = $commandLineArguments.val();

    let flavor = getSelectedLanguageFlavor();

    if (languageId === 44) {
        sourceValue = sourceEditor.getValue();
    }

    let data = {
        source_code: sourceValue,
        language_id: languageId,
        stdin: stdinValue,
        compiler_options: compilerOptions,
        command_line_arguments: commandLineArguments,
        redirect_stderr_to_stdout: true
    };

    let sendRequest = function (data) {
        window.top.postMessage(JSON.parse(JSON.stringify({
            event: "preExecution",
            source_code: sourceEditor.getValue(),
            language_id: languageId,
            flavor: flavor,
            stdin: stdinEditor.getValue(),
            compiler_options: compilerOptions,
            command_line_arguments: commandLineArguments
        })), "*");

        timeStart = performance.now();
        $.ajax({
            url: `${AUTHENTICATED_BASE_URL[flavor]}/submissions?base64_encoded=true&wait=false`,
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify(data),
            headers: AUTH_HEADERS,
            success: function (data, textStatus, request) {
                console.log(`Your submission token is: ${data.token}`);
                let region = request.getResponseHeader('X-Judge0-Region');
                setTimeout(fetchSubmission.bind(null, flavor, region, data.token, 1), INITIAL_WAIT_TIME_MS);
            },
            error: handleRunError
        });
    }

    if (languageId === 82) {
        if (!sqliteAdditionalFiles) {
            $.ajax({
                url: `./data/additional_files_zip_base64.txt`,
                contentType: "text/plain",
                success: function (responseData) {
                    sqliteAdditionalFiles = responseData;
                    data["additional_files"] = sqliteAdditionalFiles;
                    sendRequest(data);
                },
                error: handleRunError
            });
        }
        else {
            data["additional_files"] = sqliteAdditionalFiles;
            sendRequest(data);
        }
    } else {
        sendRequest(data);
    }
}

function fetchSubmission(flavor, region, submission_token, iteration) {
    if (iteration >= MAX_PROBE_REQUESTS) {
        handleRunError({
            statusText: "Maximum number of probe requests reached.",
            status: 504
        }, null, null);
        return;
    }

    $.ajax({
        url: `${UNAUTHENTICATED_BASE_URL[flavor]}/submissions/${submission_token}?base64_encoded=true`,
        headers: {
            "X-Judge0-Region": region
        },
        success: function (data) {
            if (data.status.id <= 2) { // In Queue or Processing
                $statusLine.html(data.status.description);
                setTimeout(fetchSubmission.bind(null, flavor, region, submission_token, iteration + 1), WAIT_TIME_FUNCTION(iteration));
            } else {
                handleResult(data);
            }
        },
        error: handleRunError
    });
}

function setSourceCodeName(name) {
    $(".lm_title")[0].innerText = name;
}

function getSourceCodeName() {
    return $(".lm_title")[0].innerText;
}

function openFile(content, filename) {
    clear();
    sourceEditor.setValue(content);
    selectLanguageForExtension(filename.split(".").pop());
    setSourceCodeName(filename);
}

function saveFile(content, filename) {
    const blob = new Blob([content], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
}

async function openAction() {
    if (IS_PUTER) {
        gPuterFile = await puter.ui.showOpenFilePicker();
        openFile(await (await gPuterFile.read()).text(), gPuterFile.name);
    } else {
        document.getElementById("open-file-input").click();
    }
}

async function saveAction() {
    if (IS_PUTER) {
        if (gPuterFile) {
            gPuterFile.write(sourceEditor.getValue());
        } else {
            gPuterFile = await puter.ui.showSaveFilePicker(sourceEditor.getValue(), getSourceCodeName());
            setSourceCodeName(gPuterFile.name);
        }
    } else {
        saveFile(sourceEditor.getValue(), getSourceCodeName());
    }
}

function setFontSizeForAllEditors(fontSize) {
    sourceEditor.updateOptions({ fontSize: fontSize });
    stdinEditor.updateOptions({ fontSize: fontSize });
    stdoutEditor.updateOptions({ fontSize: fontSize });
    assistantEditor.updateOptions({ fontSize: fontSize });
}

async function loadLangauges() {
    return new Promise((resolve, reject) => {
        let options = [];

        $.ajax({
            url: UNAUTHENTICATED_CE_BASE_URL + "/languages",
            success: function (data) {
                for (let i = 0; i < data.length; i++) {
                    let language = data[i];
                    let option = new Option(language.name, language.id);
                    option.setAttribute("flavor", CE);
                    option.setAttribute("langauge_mode", getEditorLanguageMode(language.name));

                    if (language.id !== 89) {
                        options.push(option);
                    }

                    if (language.id === DEFAULT_LANGUAGE_ID) {
                        option.selected = true;
                    }
                }
            },
            error: reject
        }).always(function () {
            $.ajax({
                url: UNAUTHENTICATED_EXTRA_CE_BASE_URL + "/languages",
                success: function (data) {
                    for (let i = 0; i < data.length; i++) {
                        let language = data[i];
                        let option = new Option(language.name, language.id);
                        option.setAttribute("flavor", EXTRA_CE);
                        option.setAttribute("langauge_mode", getEditorLanguageMode(language.name));

                        if (options.findIndex((t) => (t.text === option.text)) === -1 && language.id !== 89) {
                            options.push(option);
                        }
                    }
                },
                error: reject
            }).always(function () {
                options.sort((a, b) => a.text.localeCompare(b.text));
                $selectLanguage.append(options);
                resolve();
            });
        });
    });
};

async function loadSelectedLanguage(skipSetDefaultSourceCodeName = false) {
    monaco.editor.setModelLanguage(sourceEditor.getModel(), $selectLanguage.find(":selected").attr("langauge_mode"));

    if (!skipSetDefaultSourceCodeName) {
        setSourceCodeName((await getSelectedLanguage()).source_file);
    }
}

function selectLanguageByFlavorAndId(languageId, flavor) {
    let option = $selectLanguage.find(`[value=${languageId}][flavor=${flavor}]`);
    if (option.length) {
        option.prop("selected", true);
        $selectLanguage.trigger("change", { skipSetDefaultSourceCodeName: true });
    }
}

function selectLanguageForExtension(extension) {
    let language = getLanguageForExtension(extension);
    selectLanguageByFlavorAndId(language.language_id, language.flavor);
}

async function getLanguage(flavor, languageId) {
    return new Promise((resolve, reject) => {
        if (languages[flavor] && languages[flavor][languageId]) {
            resolve(languages[flavor][languageId]);
            return;
        }

        $.ajax({
            url: `${UNAUTHENTICATED_BASE_URL[flavor]}/languages/${languageId}`,
            success: function (data) {
                if (!languages[flavor]) {
                    languages[flavor] = {};
                }

                languages[flavor][languageId] = data;
                resolve(data);
            },
            error: reject
        });
    });
}

function setDefaults() {
    setFontSizeForAllEditors(fontSize);
    sourceEditor.setValue(DEFAULT_SOURCE);
    stdinEditor.setValue(DEFAULT_STDIN);
    $compilerOptions.val(DEFAULT_COMPILER_OPTIONS);
    $commandLineArguments.val(DEFAULT_CMD_ARGUMENTS);

    $statusLine.html("");

    loadSelectedLanguage();
}

function clear() {
    sourceEditor.setValue("");
    stdinEditor.setValue("");
    $compilerOptions.val("");
    $commandLineArguments.val("");

    $statusLine.html("");
}

function refreshSiteContentHeight() {
    const navigationHeight = document.getElementById("judge0-site-navigation").offsetHeight;

    const siteContent = document.getElementById("judge0-site-content");
    siteContent.style.height = `${window.innerHeight}px`;
    siteContent.style.paddingTop = `${navigationHeight}px`;
}

function refreshLayoutSize() {
    refreshSiteContentHeight();
    layout.updateSize();
}

window.addEventListener("resize", refreshLayoutSize);
document.addEventListener("DOMContentLoaded", async function () {
    $("#select-language").dropdown();
    $("[data-content]").popup({
        lastResort: "left center"
    });

    refreshSiteContentHeight();

    console.log("Hey, Judge0 IDE is open-sourced: https://github.com/judge0/ide. Have fun!");

    $selectLanguage = $("#select-language");
    $selectLanguage.change(function (event, data) {
        let skipSetDefaultSourceCodeName = (data && data.skipSetDefaultSourceCodeName) || !!gPuterFile;
        loadSelectedLanguage(skipSetDefaultSourceCodeName);
    });

    await loadLangauges();

    $compilerOptions = $("#compiler-options");
    $commandLineArguments = $("#command-line-arguments");

    $runBtn = $("#run-btn");
    $runBtn.click(run);

    $("#open-file-input").change(function (e) {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            const reader = new FileReader();
            reader.onload = function (e) {
                openFile(e.target.result, selectedFile.name);
            };

            reader.onerror = function (e) {
                showError("Error", "Error reading file: " + e.target.error);
            };

            reader.readAsText(selectedFile);
        }
    });

    $statusLine = $("#judge0-status-line");

    $(document).on("keydown", "body", function (e) {
        if (e.metaKey || e.ctrlKey) {
            switch (e.key) {
                case "Enter": // Ctrl+Enter, Cmd+Enter
                    e.preventDefault();
                    run();
                    break;
                case "s": // Ctrl+S, Cmd+S
                    e.preventDefault();
                    save();
                    break;
                case "o": // Ctrl+O, Cmd+O
                    e.preventDefault();
                    open();
                    break;
                case "+": // Ctrl+Plus
                case "=": // Some layouts use '=' for '+'
                    e.preventDefault();
                    fontSize += 1;
                    setFontSizeForAllEditors(fontSize);
                    break;
                case "-": // Ctrl+Minus
                    e.preventDefault();
                    fontSize -= 1;
                    setFontSizeForAllEditors(fontSize);
                    break;
                case "0": // Ctrl+0
                    e.preventDefault();
                    fontSize = 13;
                    setFontSizeForAllEditors(fontSize);
                    break;
            }
        }
    });

    require(["vs/editor/editor.main"], function (ignorable) {
        layout = new GoldenLayout(layoutConfig, $("#judge0-site-content"));

        layout.registerComponent("source", function (container, state) {
            sourceEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: true,
                readOnly: state.readOnly,
                language: "cpp",
                fontFamily: "JetBrains Mono",
                minimap: {
                    enabled: true
                }
            });

            sourceEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
            setupInlineChat();
        });

        layout.registerComponent("stdin", function (container, state) {
            stdinEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                fontFamily: "JetBrains Mono",
                minimap: {
                    enabled: false
                }
            });
        });

        layout.registerComponent("stdout", function (container, state) {
            stdoutEditor = monaco.editor.create(container.getElement()[0], {
                automaticLayout: true,
                scrollBeyondLastLine: false,
                readOnly: state.readOnly,
                language: "plaintext",
                fontFamily: "JetBrains Mono",
                minimap: {
                    enabled: false
                }
            });
        });

        layout.registerComponent("assistant", function (container, state) {
            const wrapper = container.getElement()[0];
            wrapper.innerHTML = `
                <div class="chat-container" style="height: 100%; display: flex; flex-direction: column;">
                    <div class="model-selector" style="padding: 10px; border-bottom: 1px solid #444; display: flex; align-items: center; justify-content: space-between;">
                        <div style="display: flex; align-items: center;">
                            <label style="color: #e0e0e0; margin-right: 8px;">Model:</label>
                            <select class="model-select" style="
                                background: #2d2d2d;
                                color: #e0e0e0;
                                padding: 5px;
                                border: 1px solid #444;
                                border-radius: 4px;
                                width: 300px;
                            ">
                            </select>
                        </div>
                        <button class="settings-btn" style="
                            padding: 5px 10px;
                            background: #2d2d2d;
                            color: #e0e0e0;
                            border: 1px solid #444;
                            border-radius: 4px;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            gap: 5px;
                        ">
                            <i class="cog icon"></i>
                            API Keys
                        </button>
                    </div>
                    <div class="chat-messages" style="flex: 1; overflow-y: auto; padding: 10px; background: var(--vscode-editor-background); color: #e0e0e0;">
                        <style>
                            .chat-message {
                                margin-bottom: 10px;
                                line-height: 1.5;
                            }
                            .chat-message pre {
                                background: #2d2d2d;
                                padding: 10px;
                                border-radius: 4px;
                                overflow-x: auto;
                                position: relative;
                            }
                            .chat-message code {
                                color: #d4d4d4;
                            }
                            .chat-message .user {
                                color: #4CAF50;
                            }
                            .chat-message .assistant {
                                color: #64B5F6;
                            }
                            .code-actions {
                                position: absolute;
                                top: 5px;
                                right: 5px;
                                display: flex;
                                gap: 5px;
                            }
                            .code-action-btn {
                                padding: 4px 8px;
                                border-radius: 3px;
                                border: none;
                                cursor: pointer;
                                font-size: 12px;
                                opacity: 0.8;
                            }
                            .code-action-btn:hover {
                                opacity: 1;
                            }
                            .apply-btn {
                                background: #4CAF50;
                                color: white;
                            }
                            .copy-btn {
                                background: #2196F3;
                                color: white;
                            }
                        </style>
                    </div>
                    <div class="chat-input-container" style="padding: 10px; border-top: 1px solid #444; display: flex;">
                        <textarea class="chat-input" 
                            style="flex: 1; margin-right: 10px; padding: 8px; border-radius: 4px; background: #2d2d2d; color: #e0e0e0; border: 1px solid #444;" 
                            placeholder="Ask about your code..."></textarea>
                        <button class="chat-send" 
                            style="padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            Send
                        </button>
                    </div>
                </div>
            `;

            const modelSelect = wrapper.querySelector('.model-select');
            const chatInput = wrapper.querySelector('.chat-input');
            const chatSend = wrapper.querySelector('.chat-send');
            const chatMessages = wrapper.querySelector('.chat-messages');

            // Populate model selector
            fetchAvailableModels().then(() => {
                modelSelect.innerHTML = ''; // Clear existing options

                // Create option groups for each provider
                const groqGroup = document.createElement('optgroup');
                groqGroup.label = 'Groq Models';

                const openRouterGroup = document.createElement('optgroup');
                openRouterGroup.label = 'OpenRouter Models';

                Object.entries(availableModels).forEach(([id, model]) => {
                    const option = document.createElement('option');
                    option.value = id;
                    option.textContent = `${model.name} (${model.context_length.toLocaleString()} tokens)`;
                    option.title = model.description;
                    if (model.default) {
                        option.selected = true;
                        currentModel = id;
                    }

                    // Add to appropriate group
                    if (model.provider === 'groq') {
                        groqGroup.appendChild(option);
                    } else {
                        openRouterGroup.appendChild(option);
                    }
                });

                // Add groups to select element
                modelSelect.appendChild(groqGroup);
                modelSelect.appendChild(openRouterGroup);

                console.log('Selected model:', currentModel);
            });

            modelSelect.addEventListener('change', (e) => {
                currentModel = e.target.value;
                console.log('Model changed to:', currentModel); // Add debug log
            });

            function addCodeActions(preElement, code) {
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'code-actions';

                // Preview & Apply button
                const applyBtn = document.createElement('button');
                applyBtn.className = 'code-action-btn apply-btn';
                applyBtn.textContent = 'Preview & Apply';
                applyBtn.title = 'Preview and apply changes';
                applyBtn.onclick = () => {
                    const currentCode = sourceEditor.getValue();
                    showDiffModal(currentCode, code, (strategy) => {
                        applyCodeChanges(code, strategy);
                    });
                };

                // Copy button
                const copyBtn = document.createElement('button');
                copyBtn.className = 'code-action-btn copy-btn';
                copyBtn.textContent = 'Copy';
                copyBtn.title = 'Copy to clipboard';
                copyBtn.onclick = async () => {
                    await navigator.clipboard.writeText(code);
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => copyBtn.textContent = 'Copy', 2000);
                };

                actionsDiv.appendChild(applyBtn);
                actionsDiv.appendChild(copyBtn);
                preElement.appendChild(actionsDiv);
            }

            const sendMessage = async () => {
                const message = chatInput.value.trim();
                if (!message) return;

                console.log('Sending message:', message);  // Debug log

                const apiKeys = getStoredApiKeys();
                const model = AVAILABLE_MODELS[currentModel];

                console.log('Current model:', model, 'Current model ID:', currentModel);  // Debug log
                console.log('API keys present:', {
                    groq: !!apiKeys.groq,
                    openrouter: !!apiKeys.openrouter
                });  // Debug log

                // Check for required API key
                if (!model) {
                    alert('Please select a valid model');
                    return;
                }

                if (model.provider === 'groq' && !apiKeys.groq) {
                    alert('Please configure your Groq API key in settings first.');
                    return;
                }
                if (model.provider === 'openrouter' && !apiKeys.openrouter) {
                    alert('Please configure your OpenRouter API key in settings first.');
                    return;
                }

                // Show user message and loading state
                const userDiv = document.createElement('div');
                userDiv.className = 'chat-message';
                userDiv.innerHTML = `<strong class="user">You:</strong> ${message}`;
                chatMessages.appendChild(userDiv);

                chatInput.value = '';

                const loadingDiv = document.createElement('div');
                loadingDiv.className = 'chat-message';
                loadingDiv.innerHTML = '<strong class="assistant">Assistant:</strong> Thinking...';
                chatMessages.appendChild(loadingDiv);

                try {
                    console.log('Making API request...');  // Debug log
                    const response = await fetch('/api/chat', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            message,
                            context: {
                                code: sourceEditor.getValue(),
                                language: $selectLanguage.find(":selected").text(),
                            },
                            model: currentModel,
                            groq_api_key: apiKeys.groq,
                            openrouter_api_key: apiKeys.openrouter
                        })
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error?.details || `Request failed with status ${response.status}`);
                    }

                    const data = await response.json();
                    console.log('Response received:', data);  // Debug log

                    if (data.error) {
                        throw new Error(data.error.details || 'Unknown error occurred');
                    }

                    // Create a new response div
                    const responseDiv = document.createElement('div');
                    responseDiv.className = 'chat-message';
                    responseDiv.innerHTML = `<strong class="assistant">Assistant:</strong> ${renderMarkdown(data.response)}`;

                    // Replace loading div with response
                    loadingDiv.replaceWith(responseDiv);

                    // Add code block actions
                    const codeBlocks = responseDiv.querySelectorAll('pre code');
                    codeBlocks.forEach((block) => {
                        const preElement = block.parentElement;
                        const code = block.textContent;
                        addCodeActions(preElement, code);
                    });

                    // Scroll to bottom
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } catch (error) {
                    console.error('Chat error:', error);  // Debug log
                    loadingDiv.innerHTML = `<strong class="assistant">Assistant:</strong> Error: ${error.message}`;
                }
            };

            chatSend.addEventListener('click', sendMessage);
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });

            // Add this after the wrapper.innerHTML = `...` section
            const settingsModal = document.createElement('div');
            settingsModal.className = 'settings-modal';
            settingsModal.style.display = 'none';
            settingsModal.innerHTML = `
                <div class="modal-content" style="
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #1e1e1e;
                    padding: 20px;
                    border-radius: 8px;
                    width: 500px;
                    z-index: 1000;
                    box-shadow: 0 0 20px rgba(0,0,0,0.5);
                ">
                    <h3 style="color: #e0e0e0; margin-bottom: 20px;">API Settings</h3>
                    <div style="margin-bottom: 15px;">
                        <label style="color: #e0e0e0; display: block; margin-bottom: 5px;">Groq API Key:</label>
                        <input type="password" class="groq-api-key" style="
                            width: 100%;
                            padding: 8px;
                            background: #2d2d2d;
                            color: #e0e0e0;
                            border: 1px solid #444;
                            border-radius: 4px;
                        " placeholder="Enter your Groq API key">
                    </div>
                    <div style="margin-bottom: 20px;">
                        <label style="color: #e0e0e0; display: block; margin-bottom: 5px;">OpenRouter API Key:</label>
                        <input type="password" class="openrouter-api-key" style="
                            width: 100%;
                            padding: 8px;
                            background: #2d2d2d;
                            color: #e0e0e0;
                            border: 1px solid #444;
                            border-radius: 4px;
                        " placeholder="Enter your OpenRouter API key">
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button class="save-settings" style="
                            padding: 8px 16px;
                            background: #4CAF50;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                        ">Save</button>
                        <button class="close-settings" style="
                            padding: 8px 16px;
                            background: #666;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                        ">Cancel</button>
                    </div>
                </div>
            `;
            wrapper.appendChild(settingsModal);

            // Add event listeners for the settings modal
            const settingsBtn = wrapper.querySelector('.settings-btn');
            const closeSettingsBtn = wrapper.querySelector('.close-settings');
            const saveSettingsBtn = wrapper.querySelector('.save-settings');
            const groqKeyInput = wrapper.querySelector('.groq-api-key');
            const openrouterKeyInput = wrapper.querySelector('.openrouter-api-key');

            // Load saved API keys from localStorage
            groqKeyInput.value = localStorage.getItem('groq_api_key') || '';
            openrouterKeyInput.value = localStorage.getItem('openrouter_api_key') || '';

            settingsBtn.onclick = () => {
                settingsModal.style.display = 'block';
            };

            closeSettingsBtn.onclick = () => {
                settingsModal.style.display = 'none';
            };

            saveSettingsBtn.onclick = async () => {
                const groqKey = groqKeyInput.value.trim();
                const openrouterKey = openrouterKeyInput.value.trim();

                // Save to localStorage only
                if (groqKey) localStorage.setItem('groq_api_key', groqKey);
                if (openrouterKey) localStorage.setItem('openrouter_api_key', openrouterKey);

                settingsModal.style.display = 'none';

                // Show success message
                const successMsg = document.createElement('div');
                successMsg.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 12px 24px;
                    background: #4CAF50;
                    color: white;
                    border-radius: 4px;
                    z-index: 1000;
                `;
                successMsg.textContent = 'API keys saved successfully!';
                document.body.appendChild(successMsg);
                setTimeout(() => successMsg.remove(), 3000);
            };

            // Close modal when clicking outside
            window.onclick = (event) => {
                if (event.target === settingsModal) {
                    settingsModal.style.display = 'none';
                }
            };
        });

        layout.on("initialised", function () {
            setDefaults();
            refreshLayoutSize();
            window.top.postMessage({ event: "initialised" }, "*");
        });

        layout.init();
    });

    let superKey = "⌘";
    if (!/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)) {
        superKey = "Ctrl";
    }

    [$runBtn].forEach(btn => {
        btn.attr("data-content", `${superKey}${btn.attr("data-content")}`);
    });

    document.querySelectorAll(".description").forEach(e => {
        e.innerText = `${superKey}${e.innerText}`;
    });

    if (IS_PUTER) {
        puter.ui.onLaunchedWithItems(async function (items) {
            gPuterFile = items[0];
            openFile(await (await gPuterFile.read()).text(), gPuterFile.name);
        });
    }

    document.getElementById("judge0-theme-toggle-btn").addEventListener("click", toggleThemeMode);
    document.getElementById("judge0-open-file-btn").addEventListener("click", openAction);
    document.getElementById("judge0-save-btn").addEventListener("click", saveAction);

    window.onmessage = function (e) {
        if (!e.data) {
            return;
        }

        if (e.data.action === "get") {
            window.top.postMessage(JSON.parse(JSON.stringify({
                event: "getResponse",
                source_code: sourceEditor.getValue(),
                language_id: getSelectedLanguageId(),
                flavor: getSelectedLanguageFlavor(),
                stdin: stdinEditor.getValue(),
                stdout: stdoutEditor.getValue(),
                compiler_options: $compilerOptions.val(),
                command_line_arguments: $commandLineArguments.val()
            })), "*");
        } else if (e.data.action === "set") {
            if (e.data.source_code) {
                sourceEditor.setValue(e.data.source_code);
            }
            if (e.data.language_id && e.data.flavor) {
                selectLanguageByFlavorAndId(e.data.language_id, e.data.flavor);
            }
            if (e.data.stdin) {
                stdinEditor.setValue(e.data.stdin);
            }
            if (e.data.stdout) {
                stdoutEditor.setValue(e.data.stdout);
            }
            if (e.data.compiler_options) {
                $compilerOptions.val(e.data.compiler_options);
            }
            if (e.data.command_line_arguments) {
                $commandLineArguments.val(e.data.command_line_arguments);
            }
            if (e.data.api_key) {
                AUTH_HEADERS["Authorization"] = `Bearer ${e.data.api_key}`;
            }
        }
    };

    setupInlineChat();
});

const DEFAULT_SOURCE = "\
#include <algorithm>\n\
#include <cstdint>\n\
#include <iostream>\n\
#include <limits>\n\
#include <set>\n\
#include <utility>\n\
#include <vector>\n\
\n\
using Vertex    = std::uint16_t;\n\
using Cost      = std::uint16_t;\n\
using Edge      = std::pair< Vertex, Cost >;\n\
using Graph     = std::vector< std::vector< Edge > >;\n\
using CostTable = std::vector< std::uint64_t >;\n\
\n\
constexpr auto kInfiniteCost{ std::numeric_limits< CostTable::value_type >::max() };\n\
\n\
auto dijkstra( Vertex const start, Vertex const end, Graph const & graph, CostTable & costTable )\n\
{\n\
    std::fill( costTable.begin(), costTable.end(), kInfiniteCost );\n\
    costTable[ start ] = 0;\n\
\n\
    std::set< std::pair< CostTable::value_type, Vertex > > minHeap;\n\
    minHeap.emplace( 0, start );\n\
\n\
    while ( !minHeap.empty() )\n\
    {\n\
        auto const vertexCost{ minHeap.begin()->first  };\n\
        auto const vertex    { minHeap.begin()->second };\n\
\n\
        minHeap.erase( minHeap.begin() );\n\
\n\
        if ( vertex == end )\n\
        {\n\
            break;\n\
        }\n\
\n\
        for ( auto const & neighbourEdge : graph[ vertex ] )\n\
        {\n\
            auto const & neighbour{ neighbourEdge.first };\n\
            auto const & cost{ neighbourEdge.second };\n\
\n\
            if ( costTable[ neighbour ] > vertexCost + cost )\n\
            {\n\
                minHeap.erase( { costTable[ neighbour ], neighbour } );\n\
                costTable[ neighbour ] = vertexCost + cost;\n\
                minHeap.emplace( costTable[ neighbour ], neighbour );\n\
            }\n\
        }\n\
    }\n\
\n\
    return costTable[ end ];\n\
}\n\
\n\
int main()\n\
{\n\
    constexpr std::uint16_t maxVertices{ 10000 };\n\
\n\
    Graph     graph    ( maxVertices );\n\
    CostTable costTable( maxVertices );\n\
\n\
    std::uint16_t testCases;\n\
    std::cin >> testCases;\n\
\n\
    while ( testCases-- > 0 )\n\
    {\n\
        for ( auto i{ 0 }; i < maxVertices; ++i )\n\
        {\n\
            graph[ i ].clear();\n\
        }\n\
\n\
        std::uint16_t numberOfVertices;\n\
        std::uint16_t numberOfEdges;\n\
\n\
        std::cin >> numberOfVertices >> numberOfEdges;\n\
\n\
        for ( auto i{ 0 }; i < numberOfEdges; ++i )\n\
        {\n\
            Vertex from;\n\
            Vertex to;\n\
            Cost   cost;\n\
\n\
            std::cin >> from >> to >> cost;\n\
            graph[ from ].emplace_back( to, cost );\n\
        }\n\
\n\
        Vertex start;\n\
        Vertex end;\n\
\n\
        std::cin >> start >> end;\n\
\n\
        auto const result{ dijkstra( start, end, graph, costTable ) };\n\
\n\
        if ( result == kInfiniteCost )\n\
        {\n\
            std::cout << \"NO\\n\";\n\
        }\n\
        else\n\
        {\n\
            std::cout << result << '\\n';\n\
        }\n\
    }\n\
\n\
    return 0;\n\
}\n\
";

const DEFAULT_STDIN = "\
3\n\
3 2\n\
1 2 5\n\
2 3 7\n\
1 3\n\
3 3\n\
1 2 4\n\
1 3 7\n\
2 3 1\n\
1 3\n\
3 1\n\
1 2 4\n\
1 3\n\
";

const DEFAULT_COMPILER_OPTIONS = "";
const DEFAULT_CMD_ARGUMENTS = "";
const DEFAULT_LANGUAGE_ID = 105; // C++ (GCC 14.1.0) (https://ce.judge0.com/languages/105)

function getEditorLanguageMode(languageName) {
    const DEFAULT_EDITOR_LANGUAGE_MODE = "plaintext";
    const LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE = {
        "Bash": "shell",
        "C": "c",
        "C3": "c",
        "C#": "csharp",
        "C++": "cpp",
        "Clojure": "clojure",
        "F#": "fsharp",
        "Go": "go",
        "Java": "java",
        "JavaScript": "javascript",
        "Kotlin": "kotlin",
        "Objective-C": "objective-c",
        "Pascal": "pascal",
        "Perl": "perl",
        "PHP": "php",
        "Python": "python",
        "R": "r",
        "Ruby": "ruby",
        "SQL": "sql",
        "Swift": "swift",
        "TypeScript": "typescript",
        "Visual Basic": "vb"
    }

    for (let key in LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE) {
        if (languageName.toLowerCase().startsWith(key.toLowerCase())) {
            return LANGUAGE_NAME_TO_LANGUAGE_EDITOR_MODE[key];
        }
    }
    return DEFAULT_EDITOR_LANGUAGE_MODE;
}

const EXTENSIONS_TABLE = {
    "asm": { "flavor": CE, "language_id": 45 }, // Assembly (NASM 2.14.02)
    "c": { "flavor": CE, "language_id": 103 }, // C (GCC 14.1.0)
    "cpp": { "flavor": CE, "language_id": 105 }, // C++ (GCC 14.1.0)
    "cs": { "flavor": EXTRA_CE, "language_id": 29 }, // C# (.NET Core SDK 7.0.400)
    "go": { "flavor": CE, "language_id": 95 }, // Go (1.18.5)
    "java": { "flavor": CE, "language_id": 91 }, // Java (JDK 17.0.6)
    "js": { "flavor": CE, "language_id": 102 }, // JavaScript (Node.js 22.08.0)
    "lua": { "flavor": CE, "language_id": 64 }, // Lua (5.3.5)
    "pas": { "flavor": CE, "language_id": 67 }, // Pascal (FPC 3.0.4)
    "php": { "flavor": CE, "language_id": 98 }, // PHP (8.3.11)
    "py": { "flavor": EXTRA_CE, "language_id": 25 }, // Python for ML (3.11.2)
    "r": { "flavor": CE, "language_id": 99 }, // R (4.4.1)
    "rb": { "flavor": CE, "language_id": 72 }, // Ruby (2.7.0)
    "rs": { "flavor": CE, "language_id": 73 }, // Rust (1.40.0)
    "scala": { "flavor": CE, "language_id": 81 }, // Scala (2.13.2)
    "sh": { "flavor": CE, "language_id": 46 }, // Bash (5.0.0)
    "swift": { "flavor": CE, "language_id": 83 }, // Swift (5.2.3)
    "ts": { "flavor": CE, "language_id": 101 }, // TypeScript (5.6.2)
    "txt": { "flavor": CE, "language_id": 43 }, // Plain Text
};

function getLanguageForExtension(extension) {
    return EXTENSIONS_TABLE[extension] || { "flavor": CE, "language_id": 43 }; // Plain Text (https://ce.judge0.com/languages/43)
}

function renderMarkdown(text) {
    // Replace backticks with HTML entities in code blocks
    let rendered = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code class="language-${lang || ''}">${code.trim()}</code></pre>`;
    });
    return rendered;
}

function createSimpleDiff(originalCode, newCode) {
    const originalLines = originalCode.split('\n');
    const newLines = newCode.split('\n');
    let diff = [];

    diff.push('=== Original Code ===');
    originalLines.forEach(line => {
        diff.push(`  ${line}`);
    });

    diff.push('\n=== Suggested Changes ===');
    newLines.forEach((line, i) => {
        if (i >= originalLines.length) {
            diff.push(`+ ${line}`);
        } else if (line !== originalLines[i]) {
            diff.push(`- ${originalLines[i]}`);
            diff.push(`+ ${line}`);
        } else {
            diff.push(`  ${line}`);
        }
    });

    if (newLines.length < originalLines.length) {
        originalLines.slice(newLines.length).forEach(line => {
            diff.push(`- ${line}`);
        });
    }

    return diff.join('\n');
}

function createMonacoRange(startLine, startCol, endLine, endCol) {
    return new monaco.Range(startLine, startCol, endLine, endCol);
}

function getSelectedCodeRange() {
    const selection = sourceEditor.getSelection();
    if (selection.isEmpty()) {
        return null;
    }
    return {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn
    };
}

const APPLY_STRATEGIES = {
    REPLACE: 'replace',
    MERGE: 'merge',
    APPEND: 'append'
};

function showDiffModal(originalCode, newCode, onApply) {
    const modal = document.createElement('div');
    modal.className = 'diff-modal';
    modal.innerHTML = `
        <div class="diff-modal-content" style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #1e1e1e;
            padding: 20px;
            border-radius: 8px;
            width: 80%;
            max-height: 80vh;
            overflow-y: auto;
            z-index: 1000;
            box-shadow: 0 0 20px rgba(0,0,0,0.5);
        ">
            <h3 style="color: #e0e0e0; margin-bottom: 15px;">Apply Code Changes</h3>
            <div class="diff-preview" style="
                background: #2d2d2d;
                padding: 15px;
                border-radius: 4px;
                margin-bottom: 15px;
                font-family: monospace;
                white-space: pre;
                color: #d4d4d4;
                line-height: 1.5;
            ">
                <style>
                    .diff-preview {
                        counter-reset: line;
                    }
                    .diff-line {
                        display: block;
                        white-space: pre;
                    }
                    .diff-line:before {
                        counter-increment: line;
                        content: counter(line);
                        display: inline-block;
                        padding: 0 1em;
                        margin-right: 0.5em;
                        color: #666;
                        border-right: 1px solid #444;
                        min-width: 3em;
                        text-align: right;
                    }
                    .diff-line.removed {
                        background: rgba(255, 0, 0, 0.1);
                        color: #ff8080;
                    }
                    .diff-line.added {
                        background: rgba(0, 255, 0, 0.1);
                        color: #80ff80;
                    }
                    .diff-header {
                        color: #666;
                        font-weight: bold;
                        padding: 5px 0;
                        margin: 10px 0;
                        border-bottom: 1px solid #444;
                    }
                </style>
            </div>
            <div class="apply-options" style="margin-bottom: 15px;">
                <label style="color: #e0e0e0; display: block; margin-bottom: 10px;">Apply Strategy:</label>
                <select class="strategy-select" style="
                    background: #2d2d2d;
                    color: #e0e0e0;
                    padding: 5px;
                    border: 1px solid #444;
                    border-radius: 4px;
                    width: 200px;
                ">
                    <option value="${APPLY_STRATEGIES.REPLACE}">Replace All</option>
                    <option value="${APPLY_STRATEGIES.MERGE}">Merge at Cursor</option>
                    <option value="${APPLY_STRATEGIES.APPEND}">Append to End</option>
                </select>
            </div>
            <div class="modal-actions" style="display: flex; gap: 10px;">
                <button class="apply-btn" style="
                    background: #4CAF50;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                ">Apply Changes</button>
                <button class="cancel-btn" style="
                    background: #666;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                ">Cancel</button>
            </div>
        </div>
    `;

    // Format the diff with line numbers and colors
    const diffPreview = modal.querySelector('.diff-preview');
    const diffLines = createSimpleDiff(originalCode, newCode).split('\n');
    const formattedDiff = diffLines.map(line => {
        if (line.startsWith('===')) {
            return `<div class="diff-header">${line}</div>`;
        }
        let className = 'diff-line';
        if (line.startsWith('+')) className += ' added';
        if (line.startsWith('-')) className += ' removed';
        return `<span class="${className}">${line}</span>`;
    }).join('\n');

    diffPreview.innerHTML += formattedDiff;

    // Rest of the modal code...
    const applyBtn = modal.querySelector('.apply-btn');
    const cancelBtn = modal.querySelector('.cancel-btn');
    const strategySelect = modal.querySelector('.strategy-select');

    applyBtn.onclick = () => {
        const strategy = strategySelect.value;
        onApply(strategy);
        document.body.removeChild(modal);
    };

    cancelBtn.onclick = () => {
        document.body.removeChild(modal);
    };

    document.body.appendChild(modal);
}

function applyCodeChanges(code, strategy) {
    const editor = sourceEditor;
    const model = editor.getModel();
    const selection = getSelectedCodeRange();

    switch (strategy) {
        case APPLY_STRATEGIES.REPLACE:
            editor.executeEdits('assistant', [{
                range: model.getFullModelRange(),
                text: code
            }]);
            break;

        case APPLY_STRATEGIES.MERGE:
            if (selection) {
                editor.executeEdits('assistant', [{
                    range: selection,
                    text: code
                }]);
            } else {
                const position = editor.getPosition();
                editor.executeEdits('assistant', [{
                    range: createMonacoRange(
                        position.lineNumber,
                        position.column,
                        position.lineNumber,
                        position.column
                    ),
                    text: code
                }]);
            }
            break;

        case APPLY_STRATEGIES.APPEND:
            const lastLine = model.getLineCount();
            const lastLineLength = model.getLineMaxColumn(lastLine);
            editor.executeEdits('assistant', [{
                range: createMonacoRange(lastLine, lastLineLength, lastLine, lastLineLength),
                text: '\n' + code
            }]);
            break;
    }
}

function setupInlineChat() {
    // Add context menu action
    sourceEditor.addAction({
        id: 'askAboutSelection',
        label: 'Ask AI About Selection',
        contextMenuGroupId: 'ai',
        contextMenuOrder: 1.5,
        run: async function (editor) {
            const selection = editor.getSelection();
            const selectedText = editor.getModel().getValueInRange(selection);

            if (!selectedText) {
                return;
            }

            // Create inline widget
            const contentWidget = {
                domNode: null,
                getId: function () {
                    return 'inline-chat-widget';
                },
                getDomNode: function () {
                    if (!this.domNode) {
                        this.domNode = document.createElement('div');
                        this.domNode.className = 'inline-chat-widget';
                        this.domNode.style.cssText = `
                            position: absolute;
                            z-index: 1000;
                            background: #1e1e1e;
                            border: 1px solid #444;
                            border-radius: 6px;
                            max-width: 800px;
                            padding: 16px;
                            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
                        `;

                        // Create input field first
                        const inputContainer = document.createElement('div');
                        inputContainer.style.cssText = `
                            display: flex;
                            gap: 8px;
                            align-items: center;
                        `;

                        const input = document.createElement('input');
                        input.type = 'text';
                        input.placeholder = 'Ask about this code...';
                        input.style.cssText = `
                            flex: 1;
                            padding: 8px;
                            background: #2d2d2d;
                            color: #e0e0e0;
                            border: 1px solid #444;
                            border-radius: 4px;
                            font-size: 13px;
                        `;

                        const askButton = document.createElement('button');
                        askButton.textContent = 'Ask';
                        askButton.style.cssText = `
                            padding: 8px 16px;
                            background: #4CAF50;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                        `;

                        const closeButton = document.createElement('button');
                        closeButton.textContent = 'Cancel';
                        closeButton.style.cssText = `
                            padding: 8px 16px;
                            background: #666;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                        `;

                        inputContainer.appendChild(input);
                        inputContainer.appendChild(askButton);
                        inputContainer.appendChild(closeButton);
                        this.domNode.appendChild(inputContainer);

                        // Handle ask button click
                        const handleAsk = async () => {
                            const question = input.value.trim();
                            if (!question) return;

                            // Show loading state
                            this.domNode.innerHTML = `
                                <div style="padding: 16px; color: #e0e0e0;">
                                    <strong class="assistant" style="color: #64B5F6;">Assistant:</strong> 
                                    Thinking...
                                </div>
                            `;

                            try {
                                const context = {
                                    code: selectedText,
                                    language: $selectLanguage.find(":selected").text(),
                                };

                                const response = await getChatResponse(question, context, currentModel);

                                // Create response container with better scrolling support
                                const contentContainer = document.createElement('div');
                                contentContainer.style.cssText = `
                                    max-height: 500px;
                                    overflow-y: scroll;
                                    color: #e0e0e0;
                                    padding: 16px;
                                    padding-right: 24px;
                                    margin-bottom: 16px;
                                    background: #1e1e1e;
                                    border-radius: 4px;
                                    
                                    /* Enable touch scrolling */
                                    -webkit-overflow-scrolling: touch;
                                    overscroll-behavior: contain; /* Prevent scroll chaining */
                                    
                                    /* Custom scrollbar styling */
                                    &::-webkit-scrollbar {
                                        width: 12px;
                                        height: 12px;
                                    }
                                    
                                    &::-webkit-scrollbar-track {
                                        background: #2d2d2d;
                                        border-radius: 4px;
                                    }
                                    
                                    &::-webkit-scrollbar-thumb {
                                        background: #555;
                                        border-radius: 4px;
                                        border: 2px solid #2d2d2d;
                                    }
                                    
                                    &::-webkit-scrollbar-thumb:hover {
                                        background: #666;
                                    }
                                `;
                                contentContainer.innerHTML = `
                                    <div style="margin-bottom: 12px;">
                                        <strong class="assistant" style="color: #64B5F6;">Assistant:</strong>
                                    </div>
                                    <div style="
                                        white-space: pre-wrap;
                                        word-break: break-word;
                                        line-height: 1.5;
                                        position: relative;
                                    ">${renderMarkdown(response)}</div>
                                `;

                                // Create button container
                                const buttonContainer = document.createElement('div');
                                buttonContainer.style.cssText = `
                                    display: flex;
                                    gap: 8px;
                                    margin-top: 16px;
                                `;

                                const previewButton = document.createElement('button');
                                previewButton.textContent = 'Preview & Apply';
                                previewButton.style.cssText = `
                                    padding: 6px 12px;
                                    background: #4CAF50;
                                    color: white;
                                    border: none;
                                    border-radius: 4px;
                                    cursor: pointer;
                                `;

                                const closeResponseButton = document.createElement('button');
                                closeResponseButton.textContent = 'Close';
                                closeResponseButton.style.cssText = `
                                    padding: 6px 12px;
                                    background: #666;
                                    color: white;
                                    border: none;
                                    border-radius: 4px;
                                    cursor: pointer;
                                `;

                                // Handle code preview and apply
                                const codeMatch = response.match(/```[\w]*\n([\s\S]*?)```/);
                                if (codeMatch) {
                                    const suggestedCode = codeMatch[1].trim();
                                    previewButton.onclick = () => {
                                        showDiffModal(selectedText, suggestedCode, (strategy) => {
                                            if (strategy === APPLY_STRATEGIES.REPLACE) {
                                                editor.executeEdits('assistant', [{
                                                    range: selection,
                                                    text: suggestedCode
                                                }]);
                                            } else {
                                                applyCodeChanges(suggestedCode, strategy);
                                            }
                                            editor.removeContentWidget(contentWidget);
                                        });
                                    };
                                } else {
                                    previewButton.disabled = true;
                                    previewButton.style.opacity = '0.5';
                                }

                                closeResponseButton.onclick = () => {
                                    editor.removeContentWidget(contentWidget);
                                };

                                buttonContainer.appendChild(previewButton);
                                buttonContainer.appendChild(closeResponseButton);

                                // Update the widget content
                                this.domNode.innerHTML = '';
                                this.domNode.appendChild(contentContainer);
                                this.domNode.appendChild(buttonContainer);

                            } catch (error) {
                                this.domNode.innerHTML = `
                                    <div style="padding: 16px;">
                                        <div style="color: #ff8080;">Error: ${error.message}</div>
                                        <button class="close-btn" style="
                                            padding: 4px 12px;
                                            background: #666;
                                            color: white;
                                            border: none;
                                            border-radius: 4px;
                                            cursor: pointer;
                                            margin-top: 8px;
                                        ">Close</button>
                                    </div>
                                `;

                                this.domNode.querySelector('.close-btn').onclick = () => {
                                    editor.removeContentWidget(contentWidget);
                                };
                            }
                        };

                        askButton.onclick = handleAsk;
                        closeButton.onclick = () => {
                            editor.removeContentWidget(contentWidget);
                        };

                        // Handle Enter key in input
                        input.onkeypress = (e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAsk();
                            }
                        };

                        return this.domNode;
                    }
                    return this.domNode;
                },
                getPosition: function () {
                    return {
                        position: {
                            lineNumber: selection.endLineNumber + 1,
                            column: 1
                        },
                        preference: [monaco.editor.ContentWidgetPositionPreference.BELOW]
                    };
                }
            };

            editor.addContentWidget(contentWidget);
            contentWidget.getDomNode().querySelector('input').focus();
        }
    });
}

async function fetchAvailableModels() {
    try {
        const response = await fetch('/api/models');
        availableModels = await response.json();
    } catch (error) {
        console.error('Failed to fetch models:', error);
    }
}

// Add functions to handle API keys in localStorage
function getStoredApiKeys() {
    return {
        groq: localStorage.getItem('groq_api_key'),
        openrouter: localStorage.getItem('openrouter_api_key')
    };
}
