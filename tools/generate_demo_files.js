import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'out');
const DIR_DDC = path.join(OUT_DIR, 'ddc773');
const DIR_THEER = path.join(OUT_DIR, 'theerchot.si.61');

[DIR_DDC, DIR_THEER].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

function createExcel(filePath, code, name, dept, title, manager, salary) {
  const wb = xlsx.utils.book_new();

  // Profile Sheet
  const profileData = [
    { employeeCode: code, employeeName: name, department: dept, jobTitle: title, managerCode: manager, status: 'active', email: `${code.toLowerCase()}@example.com` }
  ];
  const profileSheet = xlsx.utils.json_to_sheet(profileData);
  xlsx.utils.book_append_sheet(wb, profileSheet, 'Employee_Profile');

  // Compensation Sheet (Sensitive)
  const compData = [
    { employeeCode: code, baseSalary: salary, bonus: Math.floor(salary * 0.1), performanceRating: 'A', stockOptions: 500 }
  ];
  const compSheet = xlsx.utils.json_to_sheet(compData);
  xlsx.utils.book_append_sheet(wb, compSheet, 'Compensation_2026');

  // Warning/Disciplinary Sheet (Sensitive)
  const warningData = [
    { employeeCode: code, incidentDate: '2026-05-10', severity: 'None', details: 'No active warnings' }
  ];
  const warningSheet = xlsx.utils.json_to_sheet(warningData);
  xlsx.utils.book_append_sheet(wb, warningSheet, 'Disciplinary');

  xlsx.writeFile(wb, filePath);
  console.log(`Generated: ${filePath}`);
}

// Generate for ddc773 (6 files)
createExcel(path.join(DIR_DDC, 'EMP101.xlsx'), 'EMP101', 'John CEO', 'Executive', 'CEO', '', 150000);
createExcel(path.join(DIR_DDC, 'EMP102.xlsx'), 'EMP102', 'Jane HR', 'Human Resources', 'HR Manager', 'EMP101', 90000);
createExcel(path.join(DIR_DDC, 'EMP103.xlsx'), 'EMP103', 'Alice Ops', 'Operations', 'Ops Manager', 'EMP101', 85000);
createExcel(path.join(DIR_DDC, 'EMP104.xlsx'), 'EMP104', 'Bob Dev', 'Engineering', 'Lead Developer', 'EMP101', 95000);
createExcel(path.join(DIR_DDC, 'EMP105.xlsx'), 'EMP105', 'Charlie Data', 'Data Science', 'Data Engineer', 'EMP104', 80000);
createExcel(path.join(DIR_DDC, 'EMP106.xlsx'), 'EMP106', 'Diana QA', 'Engineering', 'QA Tester', 'EMP104', 60000);

// Generate for theerchot.si.61 (7 files)
createExcel(path.join(DIR_THEER, 'EMP201.xlsx'), 'EMP201', 'Eve Marketing', 'Marketing', 'Marketing Lead', 'EMP101', 82000);
createExcel(path.join(DIR_THEER, 'EMP202.xlsx'), 'EMP202', 'Frank Sales', 'Sales', 'Sales Manager', 'EMP101', 88000);
createExcel(path.join(DIR_THEER, 'EMP203.xlsx'), 'EMP203', 'Grace Support', 'Support', 'Support Lead', 'EMP103', 70000);
createExcel(path.join(DIR_THEER, 'EMP204.xlsx'), 'EMP204', 'Hank Field', 'Operations', 'Lead Foreman', 'EMP103', 65000);
createExcel(path.join(DIR_THEER, 'EMP205.xlsx'), 'EMP205', 'Ivy Field', 'Operations', 'Junior Foreman', 'EMP204', 45000);
createExcel(path.join(DIR_THEER, 'EMP206.xlsx'), 'EMP206', 'Jack Field', 'Operations', 'Junior Foreman', 'EMP204', 45000);
createExcel(path.join(DIR_THEER, 'EMP207.xlsx'), 'EMP207', 'Karen Support', 'Support', 'Agent', 'EMP203', 40000);

console.log('13 Mock files generated successfully in /out/ddc773 and /out/theerchot.si.61');
