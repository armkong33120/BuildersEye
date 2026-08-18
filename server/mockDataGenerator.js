import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getRegistryDir } from './employeeRegistry.js';

/**
 * Generate a hierarchical organization for scale testing.
 * @param {Object} config - { coo: 1, manager: 1, lead: 3, junior: 9 }
 */
export function generateMockOrg(config) {
    const employees = {};
    const now = new Date().toISOString();
    
    let pkCounter = 90000;
    
    const addEmp = (roleCode, title, dept, managerCode, managerName) => {
        const id = ++pkCounter;
        const code = `MOCK_${id}`;
        const name = `Mock ${title} ${id}`;
        
        employees[code] = {
            code,
            pk: id,
            name,
            department: dept,
            jobTitle: title,
            roleGroup: roleCode,
            managerCode,
            managerName,
            email: `mock_${id}@test.local`,
            employmentStatus: 'active',
            status: 'active',
            fileName: `MOCK_GENERATED.xlsx`,
            fileHash: crypto.randomBytes(8).toString('hex'),
            sheetNames: ['Profile', 'Projects'],
            profileHeaders: ['Code', 'Name', 'Title', 'Department', 'Manager'],
            rowCounts: { 'Profile': 1, 'Projects': 3 },
            sheets: {
                'Profile': {
                    headers: ['Code', 'Name', 'Title', 'Department', 'Manager'],
                    records: [{ 'Code': code, 'Name': name, 'Title': title, 'Department': dept, 'Manager': managerName }]
                },
                'Projects': {
                    headers: ['ProjectName', 'Status'],
                    records: [
                        { 'ProjectName': 'Scale Test Alpha', 'Status': 'Ongoing' },
                        { 'ProjectName': 'Load Testing', 'Status': 'Completed' }
                    ]
                }
            },
            firstSeen: now,
            lastSeen: now,
            version: 1
        };
        return employees[code];
    };

    // 1. Generate COOs
    const coos = [];
    for (let i = 0; i < (config.coo || 1); i++) {
        coos.push(addEmp('C-Level', 'Chief Operating Officer', 'Executive', 'CEO01', 'Chief Exec'));
    }

    // 2. Generate Managers
    const managers = [];
    for (let i = 0; i < (config.manager || 1); i++) {
        const parent = coos[i % coos.length] || { code: '', name: '' };
        managers.push(addEmp('Management', 'Operations Manager', 'Operations', parent.code, parent.name));
    }

    // 3. Generate Leads
    const leads = [];
    for (let i = 0; i < (config.lead || 3); i++) {
        const parent = managers[i % managers.length] || { code: '', name: '' };
        leads.push(addEmp('Supervisor', 'Lead Foreman', 'Field Ops', parent.code, parent.name));
    }

    // 4. Generate Juniors
    for (let i = 0; i < (config.junior || 9); i++) {
        const parent = leads[i % leads.length] || { code: '', name: '' };
        addEmp('Staff', 'Junior Foreman', 'Field Ops', parent.code, parent.name);
    }

    return employees;
}

export function injectMockOrg(config) {
    const mockEmps = generateMockOrg(config);
    
    // Read existing registry
    const registryDir = getRegistryDir();
    const empFile = path.join(registryDir, 'employees.json');
    
    let existing = {};
    if (fs.existsSync(empFile)) {
        try {
            existing = JSON.parse(fs.readFileSync(empFile, 'utf-8'));
        } catch (e) {}
    }
    
    // Remove old mocks
    for (const key of Object.keys(existing)) {
        if (key.startsWith('MOCK_')) {
            delete existing[key];
        }
    }
    
    // Inject new mocks
    Object.assign(existing, mockEmps);
    
    // Save
    fs.writeFileSync(empFile, JSON.stringify(existing, null, 1), 'utf-8');
    
    // Trigger sync to Neon if enabled
    if (process.env.DATABASE_URL) {
        import('./neonSync.js')
            .then(m => {
                const schemaFile = path.join(registryDir, 'schema.json');
                const schema = fs.existsSync(schemaFile) ? JSON.parse(fs.readFileSync(schemaFile, 'utf-8')) : { sheets: {} };
                m.pushRegistryToNeon(existing, schema, () => {});
            })
            .catch(() => {});
    }
    
    return Object.keys(mockEmps).length;
}
