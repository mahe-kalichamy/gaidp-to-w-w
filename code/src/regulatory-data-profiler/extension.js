const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

// TreeDataProvider for the sidebar view
class ProfilerTreeDataProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.items = [{ label: 'Open Regulatory Data Profiler', command: 'regulatory-data-profiler.showProfiler' }];
  }

  getTreeItem(element) {
    const treeItem = new vscode.TreeItem(element.label);
    treeItem.command = { command: element.command, title: 'Open Profiler' };
    return treeItem;
  }

  getChildren() {
    return Promise.resolve(this.items);
  }
}

function activate(context) {
  console.log("Regulatory Data Profiler extension activated!");

  const treeDataProvider = new ProfilerTreeDataProvider();
  vscode.window.registerTreeDataProvider('regulatoryDataProfilerView', treeDataProvider);

  let disposable = vscode.commands.registerCommand('regulatory-data-profiler.showProfiler', () => {
    console.log("Opening Regulatory Data Profiler webview...");
    const panel = vscode.window.createWebviewPanel(
      'regulatoryDataProfiler',
      'Regulatory Data Profiler',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    panel.webview.html = getWebviewContent();
    let uploadedFilePath = null;
    let generatedRules = null;

    panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'uploadFile':
            const documentUri = await vscode.window.showOpenDialog({
              canSelectMany: false,
              filters: { 'PDF Files': ['pdf'] }
            });

            if (!documentUri || documentUri.length === 0) {
              panel.webview.postMessage({ command: 'error', text: 'No document selected.' });
              return;
            }

            uploadedFilePath = documentUri[0].fsPath;
            panel.webview.postMessage({ command: 'info', text: `Document uploaded: ${path.basename(uploadedFilePath)}` });
            panel.webview.postMessage({ command: 'enableGenerateButton' }); // Fixed typo here
            console.log("Sent enableGenerateButton message"); // Debug log
            break;

          case 'generateRules':
            if (!uploadedFilePath) {
              panel.webview.postMessage({ command: 'error', text: 'Please upload a document first.' });
              return;
            }

            try {
              panel.webview.postMessage({ command: 'info', text: 'Chunking document...' });
              const chunks = await chunkDocument(uploadedFilePath, panel);
              panel.webview.postMessage({ command: 'info', text: `Created ${chunks.length} chunks.` });

              panel.webview.postMessage({ command: 'info', text: 'Generating rules...' });
              generatedRules = await generateRulesWithPrompt(chunks, panel);
              panel.webview.postMessage({ command: 'info', text: `Generated ${generatedRules.length} rules.` });

              if (generatedRules.length === 0) {
                panel.webview.postMessage({ command: 'error', text: 'No rules generated. Check document format.' });
              } else {
                panel.webview.postMessage({ command: 'displayRules', rules: generatedRules });
                panel.webview.postMessage({ command: 'enableExportButton' });
              }
            } catch (error) {
              panel.webview.postMessage({ command: 'error', text: `Error: ${error.message}` });
            }
            break;

          case 'exportRules':
            if (!generatedRules) {
              panel.webview.postMessage({ command: 'error', text: 'No rules to export.' });
              return;
            }

            const saveUri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(path.join(path.dirname(uploadedFilePath), 'generated_rules.json')),
              filters: { 'JSON Files': ['json'] }
            });

            if (saveUri) {
              fs.writeFileSync(saveUri.fsPath, JSON.stringify(generatedRules, null, 2));
              panel.webview.postMessage({ command: 'info', text: `Rules exported to ${saveUri.fsPath}` });
            }
            break;
        }
      },
      undefined,
      context.subscriptions
    );
  });

  context.subscriptions.push(disposable);
}

function getWebviewContent() {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Regulatory Data Profiler</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #f0f0f0; }
        h1 { color: #333; }
        .button-container { margin-bottom: 20px; }
        button { padding: 10px 20px; margin: 5px; background: #007acc; color: white; border: none; border-radius: 5px; cursor: pointer; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        #log { margin: 20px 0; border: 1px solid #ccc; padding: 10px; height: 100px; overflow-y: auto; background: white; }
        #rules { margin-top: 20px; }
        table { border-collapse: collapse; width: 100%; background: white; table-layout: fixed; overflow-x: auto; display: block; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; word-wrap: break-word; }
        th { background-color: #007acc; color: white; }
        td:nth-child(2), td:nth-child(5) { max-width: 300px; }
      </style>
    </head>
    <body>
      <h1>Regulatory Data Profiler</h1>
      <div class="button-container">
        <button onclick="uploadFile()">Upload Document</button>
        <button id="generateButton" onclick="generateRules()" disabled>Generate Rules</button>
        <button id="exportButton" onclick="exportRules()" disabled>Export Rules</button>
      </div>
      <div id="log"></div>
      <div id="rules"></div>

      <script>
        const vscode = acquireVsCodeApi();

        function uploadFile() { vscode.postMessage({ command: 'uploadFile' }); }
        function generateRules() { vscode.postMessage({ command: 'generateRules' }); }
        function exportRules() { vscode.postMessage({ command: 'exportRules' }); }

        window.addEventListener('message', event => {
          const message = event.data;
          console.log('Received message:', message); // Debug log
          switch (message.command) {
            case 'info':
              addLog(message.text);
              break;
            case 'error':
              addLog('ERROR: ' + message.text);
              break;
            case 'enableGenerateButton':
              console.log('Enabling Generate Rules button'); // Debug log
              document.getElementById('generateButton').disabled = false;
              break;
            case 'enableExportButton':
              document.getElementById('exportButton').disabled = false;
              break;
            case 'displayRules':
              displayRules(message.rules);
              break;
          }
        });

        function addLog(text) {
          const log = document.getElementById('log');
          log.innerHTML += '<p>' + text + '</p>';
          log.scrollTop = log.scrollHeight;
        }

        function displayRules(rules) {
          const rulesDiv = document.getElementById('rules');
          let html = '<h2>Generated Rules</h2>';
          html += '<table>';
          html += '<tr><th>Title</th><th>Description</th><th>Category</th><th>Confidence</th><th>Allowed Values</th><th>Format</th></tr>';
          rules.forEach(rule => {
            html += \`<tr>
              <td>\${rule.title}</td>
              <td>\${rule.description}</td>
              <td>\${rule.category}</td>
              <td>\${rule.confidence}%</td>
              <td>\${rule.constraints.allowedValues}</td>
              <td>\${rule.constraints.format}</td>
            </tr>\`;
          });
          html += '</table>';
          rulesDiv.innerHTML = html;
        }
      </script>
    </body>
    </html>
  `;
}

async function chunkDocument(filePath, panel) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(dataBuffer);
    const documentText = pdfData.text;

    panel.webview.postMessage({ command: 'info', text: `Extracted text length: ${documentText.length} characters` });

    const cleanedText = documentText.replace(/^Must comply with:\s*/i, '').trim();
    const lines = cleanedText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    if (lines.length === 0) {
      panel.webview.postMessage({ command: 'error', text: 'No content found in PDF.' });
      return [];
    }

    const chunks = [];
    let currentChunk = {
      title: "Unknown Field",
      description: "",
      category: "Hedging",
      constraints: { allowedValues: "N/A", format: "string" }
    };
    let collectingDescription = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.match(/^\d+$/) || line.match(/^\d+\s+.+/)) {
        if (currentChunk.description) {
          chunks.push({ ...currentChunk });
        }
        currentChunk = {
          title: "Unknown Field",
          description: "",
          category: "Hedging",
          constraints: { allowedValues: "N/A", format: "string" }
        };
        collectingDescription = true;

        if (line.match(/^\d+\s+.+/)) {
          const parts = line.match(/^\d+\s+(.+)/);
          if (parts && parts[1]) {
            currentChunk.title = parts[1];
          }
        }
        continue;
      }

      if (collectingDescription && line && currentChunk.title === "Unknown Field" && !line.match(/^\d+$/) && !line.match(/See Securities/i)) {
        currentChunk.title = line;
        continue;
      }

      if (collectingDescription && line) {
        const nextLine = lines[i + 1];
        if (line.match(/See Securities/i) || (nextLine && (nextLine.match(/^\d+$/) || nextLine.match(/^\d+\s+.+/)))) {
          collectingDescription = false;
        }
        currentChunk.description += (currentChunk.description ? "\n" : "") + line;
      }
    }

    if (currentChunk.description) {
      chunks.push({ ...currentChunk });
    }

    panel.webview.postMessage({ command: 'info', text: `Parsed ${chunks.length} potential chunks` });
    return chunks;
  } catch (error) {
    throw new Error(`Failed to chunk document: ${error.message}`);
  }
}

async function generateRulesWithPrompt(chunks, panel) {
  const rules = [];
  let ruleCounter = 1;

  for (const chunk of chunks) {
    const chunkRules = await extractRulesFromTable(chunk, ruleCounter);
    if (chunkRules.length > 0) {
      rules.push(...chunkRules);
      ruleCounter += chunkRules.length;
    }
  }

  panel.webview.postMessage({ command: 'info', text: `Total rules extracted: ${rules.length}` });
  return rules;
}

function predictConfidence({ title, description, allowedValues, format }) {
  let confidence = 0; // Base confidence

  if (title && title !== "Unknown Field") confidence += 15;
  if (description) confidence += 15;
  if (allowedValues && allowedValues !== "N/A") confidence += 15;
  if (description && description.length > 20) confidence += 5;
  if (description && description.toLowerCase().includes('asc 815')) confidence += 5;
  if (format === 'decimal' || format === 'integer' || format === 'date') confidence += 5;

  return Math.min(confidence, 95);
}

async function extractRulesFromTable(chunk, ruleCounter) {
  const rules = [];
  const trimmedChunk = chunk.description ? chunk.description.trim() : chunk.trim();

  if (!trimmedChunk) return rules;

  const lines = trimmedChunk.split('\n').map(line => line.trim());
  let fieldName = chunk.title !== "Unknown Field" ? chunk.title : "";
  let description = "";
  let allowableValues = "";

  let i = 0;
  while (i < lines.length && !lines[i].match(/^\d+=/) && !lines[i].match(/decimal/i) && !lines[i].match(/yyyy-mm-dd/i) && !lines[i].match(/whole dollar/i)) {
    description += (description ? " " : "") + lines[i];
    i++;
  }
  description = description.trim();

  while (i < lines.length) {
    allowableValues += (allowableValues ? " " : "") + lines[i];
    i++;
  }
  allowableValues = allowableValues.trim();

  if (!fieldName || !description) return rules;

  const category = "Hedging";

  let format = 'string';
  if (allowableValues.match(/decimal/i) || description.match(/decimal/i)) {
    format = 'decimal';
  } else if (allowableValues.match(/\d+=/) || allowableValues.match(/whole dollar/i) || description.match(/integer|number/i)) {
    format = 'integer';
  } else if (allowableValues.match(/yyyy-mm-dd/i)) {
    format = 'date';
  }

  const rule = {
    title: fieldName,
    description: description,
    category: category,
    confidence: predictConfidence({
      title: fieldName,
      description: description,
      allowedValues: allowableValues || "N/A",
      format: format
    }),
    constraints: {
      allowedValues: allowableValues || "N/A",
      format: format
    }
  };

  rules.push(rule);
  return rules;
}

function deactivate() {}

module.exports = { activate, deactivate };