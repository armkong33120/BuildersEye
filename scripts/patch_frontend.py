#!/usr/bin/env python3
"""Patch src/main.js for RAG backend integration."""
import os

TARGET = "/Users/arm/AI Test/mail-onedrive-org-graph/src/main.js"

with open(TARGET, "r") as f:
    content = f.read()

# 1. Add RAG functions after resumeAutoRotate
# Find the function resumeAutoRotate and the blank line after its closing brace
marker = "function resumeAutoRotate()"
idx = content.find(marker)
# Find end of function (closing brace at start of line)
close_idx = content.index("\nfunction ", idx + 100)  # next function after resumeAutoRotate

rag_code = """

// RAG backend integration
const RAG_BACKEND = 'http://localhost:5199';

async function callRagBackend(query) {
  try {
    const res = await fetch(RAG_BACKEND + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

function highlightRagResults(data) {
  clearScanEffects();
  var nodePks = new Set(data.scan?.employeePks || data.matchedEmployeePks || []);
  var edgeKeys = new Set();
  lineObjects.forEach(function(line) {
    if (nodePks.has(line.userData.sourcePk) && nodePks.has(line.userData.targetPk)) {
      edgeKeys.add(edgeKey(line.userData.sourcePk, line.userData.targetPk));
    }
  });
  if (nodePks.size > 0) {
    createScanNodeHalos(nodePks, '#63d8ff');
    if (edgeKeys.size > 0) createScanPathLines(edgeKeys, '#ffd166');
    pauseAutoRotate(7000);
  }
  state.scan = {
    startedAt: performance.now(), duration: 7000,
    sourcePk: graph.ceoPk, nodePks: nodePks, edgeKeys: edgeKeys, mode: 'rag-search',
  };
}
"""

content = content[:close_idx] + rag_code + content[close_idx:]

# 2. Make handleChatSubmit async
content = content.replace(
    "function handleChatSubmit(event) {",
    "async function handleChatSubmit(event) {"
)

# 3. Insert RAG call after chatInput.value = '' and before department check
old_block = """  chatInput.value = '';
  const department = findDepartmentPrompt(prompt);"""

new_block = """  chatInput.value = '';

  // Try RAG backend first
  var ragData = await callRagBackend(prompt);
  if (ragData && ragData.matchedEmployeePks && ragData.matchedEmployeePks.length > 0) {
    var policyTag = ragData.policy && ragData.policy.status && ragData.policy.status !== 'Allowed'
      ? ' [Policy: ' + ragData.policy.status + ']' : '';
    var sources = (ragData.sources || []).slice(0, 4).map(function(s) { return s.fileName || s.file + ':' + s.sheetName; });
    appendChatMessage('assistant', 'RAG' + policyTag, ragData.answer, sources);
    highlightRagResults(ragData);
    return;
  }

  const department = findDepartmentPrompt(prompt);"""

if old_block in content:
    content = content.replace(old_block, new_block)
else:
    print("WARNING: Could not find exact match for old_block. Trying alternative...")
    # Fallback: find the line after chatInput.value = ''
    marker2 = "chatInput.value = '';"
    idx2 = content.find(marker2)
    if idx2 != -1:
        end_of_line = content.index("\n", idx2) + 1
        # Insert right after this line
        rag_block2 = """  // Try RAG backend first
  var ragData = await callRagBackend(prompt);
  if (ragData && ragData.matchedEmployeePks && ragData.matchedEmployeePks.length > 0) {
    var policyTag = ragData.policy && ragData.policy.status && ragData.policy.status !== 'Allowed'
      ? ' [Policy: ' + ragData.policy.status + ']' : '';
    var sources = (ragData.sources || []).slice(0, 4).map(function(s) { return s.fileName || s.file + ':' + s.sheetName; });
    appendChatMessage('assistant', 'RAG' + policyTag, ragData.answer, sources);
    highlightRagResults(ragData);
    return;
  }

"""
        content = content[:end_of_line] + rag_block2 + content[end_of_line:]
        print("Applied fallback insertion.")

with open(TARGET, "w") as f:
    f.write(content)

print("src/main.js patched successfully.")
print(f"File size: {os.path.getsize(TARGET)} bytes")