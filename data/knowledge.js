export const USERS = [
  {
    id: 1,
    name: "Thandi Mokoena",
    title: "Director: Labour Policy",
    dept: "Employment and Labour",
    unit: "Labour Policy and Industrial Relations",
    lvl: 3,
    lvlName: "Confidential"
  },
  {
    id: 2,
    name: "Sipho Dlamini",
    title: "Administrative Officer",
    dept: "Employment and Labour",
    unit: "Corporate Services",
    lvl: 1,
    lvlName: "Public"
  },
  {
    id: 3,
    name: "Lerato Naidoo",
    title: "Chief Director: Supply Chain Management",
    dept: "National Treasury",
    unit: "Office of the Chief Procurement Officer",
    lvl: 3,
    lvlName: "Confidential"
  }
];

export const DIR = {
  "Employment and Labour": {
    project: "Office of the Chief Financial Officer: Budget and Planning",
    default: "Corporate Services: Policy and Knowledge Management"
  },
  "National Treasury": {
    project: "Public Finance: Budget Office",
    default: "Legal Services"
  }
};

export const DOCS = [
  {
    id: "bcea",
    dept: "Employment and Labour",
    title: "Basic Conditions of Employment Act 75 of 1997",
    cat: "Legislation",
    owner: "Department of Employment and Labour",
    ver: "As amended",
    st: "cur",
    date: "1997",
    cls: 1,
    src: "gov.za (official government source)",
    url: "https://www.gov.za/documents/basic-conditions-employment-act",
    sum: "Sets minimum conditions for working hours, leave, overtime and termination.",
    sections: [
      {
        sec: "Section 9 — Ordinary hours of work",
        text: "An employer may not require or permit an employee to work more than 45 hours in any week; and more than nine hours in any day if the employee works for five days or fewer in a week, or eight hours in any day if the employee works on more than five days in a week."
      },
      {
        sec: "Section 10 — Overtime",
        text: "An employer may not require or permit an employee to work overtime except in accordance with an agreement, and not more than 10 hours overtime a week. An employer must pay an employee at least one and one-half times (1.5x) the employee's wage for overtime worked, or by agreement grant paid time off."
      },
      {
        sec: "Section 16 — Pay for work on Sundays",
        text: "An employer must pay an employee who works on a Sunday at double the employee's wage for each hour worked, unless the employee ordinarily works on a Sunday, in which case the employer must pay at least one and one-half times the wage."
      },
      {
        sec: "Section 20 — Annual leave",
        text: "An employer must grant an employee at least 21 consecutive days' annual leave on full remuneration in respect of each annual leave cycle, or by agreement one day for every 17 days worked."
      }
    ]
  },
  {
    id: "lra",
    dept: "Employment and Labour",
    title: "Labour Relations Act 66 of 1995",
    cat: "Legislation",
    owner: "Department of Employment and Labour",
    ver: "As amended",
    st: "cur",
    date: "1995",
    cls: 1,
    src: "gov.za (official government source)",
    url: "https://www.gov.za/documents/labour-relations-act",
    sum: "Governs collective bargaining, dispute resolution, strikes and unfair dismissal.",
    sections: [
      {
        sec: "Section 1 — Purpose of the Act",
        text: "Advancing economic development, social justice, labour peace and the democratisation of the workplace through collective bargaining, orderly dispute resolution via the CCMA and Labour Courts, and employee participation."
      },
      {
        sec: "Section 185–188 — Unfair dismissal",
        text: "Every employee has the right not to be unfairly dismissed or subjected to unfair labour practices. A dismissal is unfair unless the employer proves a fair reason related to conduct, capacity or operational requirements, and that it followed a fair procedure."
      }
    ]
  },
  {
    id: "eea",
    dept: "Employment and Labour",
    title: "Employment Equity Act 55 of 1998",
    cat: "Legislation",
    owner: "Department of Employment and Labour",
    ver: "As amended",
    st: "cur",
    date: "1998",
    cls: 1,
    src: "gov.za (official government source)",
    url: "https://www.gov.za/documents/employment-equity-act",
    sum: "Promotes equity and prohibits unfair discrimination in employment.",
    sections: [
      {
        sec: "Section 6 — Prohibition of unfair discrimination",
        text: "No person may unfairly discriminate, directly or indirectly, against an employee in any employment policy or practice on prohibited grounds including race, gender, sex, pregnancy, marital status, ethnic or social origin, age, disability, religion, conscience or belief."
      },
      {
        sec: "Section 15 — Affirmative action measures",
        text: "Designated employers must implement affirmative action measures for suitably qualified people from designated groups to ensure equitable representation in all occupational levels of the workforce."
      }
    ]
  },
  {
    id: "ot19",
    dept: "Employment and Labour",
    title: "Overtime Administration Circular 4 of 2019",
    cat: "Circulars",
    owner: "Corporate Services",
    ver: "1.0",
    st: "sup",
    date: "2019-03-12",
    cls: 1,
    rep: "ot24",
    src: "Departmental intranet (simulated)",
    sum: "Internal procedure for approving staff overtime. Superseded by Overtime Administration Circular 2 of 2024.",
    sections: [
      {
        sec: "Clause 2 — Legacy approval threshold (SUPERSEDED)",
        text: "Under the 2019 circular, line managers could authorise up to 20 hours of overtime per month using manual Form HR-14. This circular was formally replaced on 2024-02-01 by Overtime Administration Circular 2 of 2024 and must no longer be relied upon."
      }
    ]
  },
  {
    id: "ot24",
    dept: "Employment and Labour",
    title: "Overtime Administration Circular 2 of 2024",
    cat: "Circulars",
    owner: "Corporate Services",
    ver: "2.0",
    st: "cur",
    date: "2024-02-01",
    cls: 1,
    src: "Departmental intranet (simulated)",
    sum: "Current internal procedure for approving staff overtime. Replaces Circular 4 of 2019.",
    sections: [
      {
        sec: "Clause 1 — Replacement and scope",
        text: "This circular takes effect on 1 February 2024 and supersedes Overtime Administration Circular 4 of 2019 in full. It applies to all departmental staff eligible for remunerated overtime or time off in lieu."
      },
      {
        sec: "Clause 3 — Prior written approval",
        text: "All overtime must be approved in writing on the electronic HR workflow before the hours are worked, except in documented emergency inspection duties where post-facto motivation must be submitted within 48 hours."
      },
      {
        sec: "Clause 4 — Monthly limits and compensation",
        text: "Subject to Section 10 of the Basic Conditions of Employment Act (maximum 10 overtime hours per week), supervisor approval covers up to 15 hours per month; hours above 15 require Chief Director sign-off and budget confirmation from Finance. Payment is at 1.5x basic rate or 2x on Sundays/public holidays unless commuted time off is agreed."
      }
    ]
  },
  {
    id: "rec",
    dept: "Employment and Labour",
    title: "Recruitment and Selection Policy",
    cat: "Departmental policies",
    owner: "Human Resource Management",
    ver: "3.1",
    st: "rev",
    date: "2023-09-15",
    cls: 2,
    src: "SharePoint: HR Policies (simulated)",
    sum: "Currently under review. Check with the document owner before relying on it.",
    sections: [
      {
        sec: "Section 4 — Shortlisting and panel composition (UNDER REVIEW)",
        text: "Selection panels must comprise at least three officials graded higher than the post being filled, including an HR representative and employment equity observer. Note: This policy is under formal review by Human Resource Management; confirm current transitional rules with the owner before convening a panel."
      }
    ]
  },
  {
    id: "ben",
    dept: "Employment and Labour",
    title: "Beneficiary Selection Guidelines: Employment Schemes",
    cat: "Guidelines",
    owner: "Employment Services",
    ver: "1.4",
    st: "cur",
    date: "2024-06-30",
    cls: 3,
    src: "Document management system (simulated)",
    sum: "Criteria for selecting beneficiaries of employment programmes.",
    sections: [
      {
        sec: "Section 3 — Eligibility criteria",
        text: "Applicants must be South African citizens or permanent residents aged 18–60, registered on the Employment Services database, and currently unemployed or underemployed below the programme threshold."
      },
      {
        sec: "Section 5 — Priority scoring and verification",
        text: "Selection committees must apply weighted scoring prioritising youth (18–35), women, persons with disabilities, and long-term unemployed applicants, and verify identity and household status before stipend enrolment."
      }
    ]
  },
  {
    id: "dis",
    dept: "Employment and Labour",
    title: "Draft Remote Work Policy",
    cat: "Departmental policies",
    owner: "Human Resource Management",
    ver: "0.3",
    st: "dra",
    date: "2025-01-20",
    cls: 2,
    src: "SharePoint: HR Policies (simulated)",
    sum: "Draft only. Not approved and not in force.",
    sections: [
      {
        sec: "Clause 2 — Proposed hybrid eligibility (DRAFT ONLY)",
        text: "Proposes allowing non-frontline staff with satisfactory performance ratings to apply for up to two remote workdays per week with Director approval. IMPORTANT: This is an unapproved v0.3 draft and is NOT in force."
      }
    ]
  },
  {
    id: "pfma",
    dept: "National Treasury",
    title: "Public Finance Management Act 1 of 1999",
    cat: "Legislation",
    owner: "National Treasury",
    ver: "As amended",
    st: "cur",
    date: "1999",
    cls: 1,
    src: "treasury.gov.za (National Treasury)",
    url: "https://www.treasury.gov.za/legislation/pfma/default.aspx",
    sum: "Regulates financial management in national and provincial government.",
    sections: [
      {
        sec: "Section 2 — Object of the Act",
        text: "To secure transparency, accountability, and sound management of the revenue, expenditure, assets and liabilities of national and provincial government institutions."
      },
      {
        sec: "Section 38 — General responsibilities of accounting officers",
        text: "The accounting officer for a department must ensure effective, efficient and transparent systems of financial and risk management and internal control, an appropriate procurement and provisioning system which is fair, equitable, transparent, competitive and cost-effective, and must prevent unauthorised, irregular, fruitless and wasteful expenditure."
      },
      {
        sec: "Section 45 — Responsibilities of other officials",
        text: "An official in a department must ensure the system of financial management and internal control established for that department is carried out within the area of responsibility of that official, and prevent any unauthorised, irregular or fruitless and wasteful expenditure."
      }
    ]
  },
  {
    id: "tr",
    dept: "National Treasury",
    title: "Treasury Regulations for Departments",
    cat: "Regulations",
    owner: "National Treasury",
    ver: "2005 as amended",
    st: "cur",
    date: "2005",
    cls: 1,
    src: "treasury.gov.za (National Treasury)",
    url: "https://www.treasury.gov.za/legislation/pfma/default.aspx",
    sum: "Regulations issued under the PFMA.",
    sections: [
      {
        sec: "Regulation 8 — Expenditure management",
        text: "The accounting officer must ensure internal procedures and controls are in place for payment approval, and unless determined otherwise in a contract or agreement, all payments due to creditors must be settled within 30 days from receipt of an invoice."
      },
      {
        sec: "Regulation 16A — Supply chain management",
        text: "Accounting officers must develop and implement an effective and efficient supply chain management system for the acquisition of goods and services and disposal/letting of state assets, aligned to section 217 of the Constitution."
      }
    ]
  },
  {
    id: "scm",
    dept: "National Treasury",
    title: "SCM Instruction Note: Bid Evaluation (simulated)",
    cat: "Circulars",
    owner: "Office of the Chief Procurement Officer",
    ver: "1.2",
    st: "cur",
    date: "2024-04-10",
    cls: 3,
    src: "Treasury intranet (simulated)",
    sum: "Internal guidance on bid evaluation committees.",
    sections: [
      {
        sec: "Clause 4 — Bid Evaluation Committee (BEC) quorum and conflict declarations",
        text: "A Bid Evaluation Committee must include at least three officials with relevant technical and SCM expertise. Every member must sign a declaration of interest before opening technical submissions and score bids strictly against the published evaluation criteria."
      }
    ]
  }
];
