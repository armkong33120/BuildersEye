// mcpServer.js — Model Context Protocol (MCP Server Protocol)
// ตาม AI Engineering Guidebook (หน้า 264-291): ประกาศ MCP Tools / Resources ให้ AI Agents ภายนอกเรียกใช้อย่างปลอดภัย

export function getMcpTools() {
  return [
    {
      name: 'query_org_graph',
      description: 'Query company reporting lines, employee directory, and org structure',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query in Thai or English' },
          role: { type: 'string', description: 'Viewer RBAC role (CEO, Manager, Employee)', default: 'CEO' },
        },
        required: ['query'],
      },
    },
    {
      name: 'search_it_assets',
      description: 'Search company-wide IT Asset Register (Notebooks, Phones, Tablets, Monitors)',
      inputSchema: {
        type: 'object',
        properties: {
          assetType: { type: 'string', description: 'Asset type e.g. Notebook, Mobile Phone, Tablet' },
        },
      },
    },
  ];
}

export async function handleMcpCall(toolName, args, { getActiveEmployees, searchFn }) {
  if (toolName === 'search_it_assets') {
    const employees = getActiveEmployees();
    let total = 0;
    const items = [];
    employees.forEach(e => {
      const records = e.sheets?.['IT_Asset_Register']?.records || [];
      records.forEach(r => {
        if (!args.assetType || (r.Asset_Type || '').toLowerCase().includes(args.assetType.toLowerCase())) {
          total++;
          items.push({ employeeCode: e.code, employeeName: e.name, department: e.department, ...r });
        }
      });
    });
    return {
      content: [{ type: 'text', text: JSON.stringify({ total, items: items.slice(0, 10) }) }],
    };
  }

  if (toolName === 'query_org_graph') {
    const res = await searchFn(args.query);
    return {
      content: [{ type: 'text', text: JSON.stringify(res) }],
    };
  }

  throw new Error(`Unknown MCP Tool: ${toolName}`);
}
