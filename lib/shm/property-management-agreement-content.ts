/** Full static PMA legal content — must match the official template wording. */

export const PMA_LEGISLATION_NOTE =
  "Note: legislation does not permit discrimination in relation to children, groups, pets & smokers (This is a preference only)";

export const PMA_TERMS_SECTIONS: Array<{ title: string; paragraphs: string[]; bullets?: string[] }> = [
  {
    title: "APPOINTMENT OF AGENT",
    paragraphs: [
      "The Owner appoints Sharehousemanagers.com.au Pty Ltd Lic. Agent ABN 27 685 383 493 exclusive from the date hereof to lease and manage the Property in accordance with the terms of this Agreement.",
    ],
  },
  {
    title: "MANAGEMENT FEES",
    paragraphs: ["2. Refer to attached schedule of Fees."],
  },
  {
    title: "TERMINATION OF AGREEMENT",
    paragraphs: [
      "3. This Agreement may be terminated by either party by thirty days’ notice in writing.",
      "a) Upon termination of the agreement the Owner agrees to pay the Agent:",
      "i) One week rent if agency agreement is terminated in less than 12 months.",
      "The Agent warrants upon termination to hand over all relevant details and documents and to redirect any rates, land taxes and any other such notices immediately to the Owner.",
    ],
  },
  {
    title: "KEYS",
    paragraphs: [
      "4. The Owner agrees to supply the Agent with three (3) full and complete sets of keys for the property to be managed by the Agent. If only one (1) set of keys are supplied to the Agent, then the Owner agrees to allow the Agent to have another complete set of keys cut with this cost to be borne by the Owner.",
    ],
  },
  {
    title: "INSURANCE",
    paragraphs: [
      "5. The Owner agrees to have and maintain sufficient building and contents insurance over the premises. The insurance policy must include public liability and the Owner agrees to notify the insurer that the property is rented.",
    ],
  },
  {
    title: "DUTIES OF AGENT",
    paragraphs: [
      "6. The Agent is authorised to execute all documentation in accordance with the Residential Tenancies Act 1997 on behalf of the owner including the tenancy agreement.",
      "a) the initial letting and any subsequent re-letting to the initial tenant;",
      "b) each subsequent letting and re-letting to a new tenant; and",
      "c) the general management of the Property including but not limited to:",
    ],
    bullets: [
      "collecting the rent (“Rent”) or any other monies due to the Principal in respect of the Property and paying it to the owner on the last business day of each month",
      "collecting any bond payable in relation to the Property (‘the Bond”), lodging the Bond with the Rental Bond Board and refunding or otherwise dealing with the Bond at the termination or expiration of each letting of the Property",
      "repairing and maintaining the Property as specified in this Agreement",
      "issuing notices and termination of tenancy including eviction if required",
      "advertising the Property as available for letting and display a “To Let” sign at the Property; and",
      "entering the Property for the purpose of inspections",
      "conduct periodic inspections in accordance with the Residential Tenancies Act 1997",
    ],
  },
  {
    title: "RENT",
    paragraphs: [
      "The Agent will review rents in accordance with market levels in accordance with the Residential Tenancies Act 1997",
    ],
  },
  {
    title: "EXPENDITURE",
    paragraphs: [
      "8. The Agent may incur expenditure for repairs and maintenance to the Property up to the amount specified in the Schedule (“the Specified Expenditure”) without reference to the Owner, except in emergencies when the Agent may incur such expenditure as is necessary to protect the Property and/or maintain essential services to the Property. The Agent must secure the prior approval of the Principal for amounts greater than the Specified Expenditure except for emergencies.",
    ],
  },
  {
    title: "DEDUCTIONS",
    paragraphs: [
      "9 The Agent is authorised to deduct and pay the following from any rent or other monies received by the Agent in relations to the Property:",
      "a) any statutory charges, body corporate fees or changes of a similar nature payable in respect of the Property;",
      "b) any amounts incurred for repair and maintenance of the Property; or",
      "c) any other charges that may be specified in the Schedule (‘Authorised Deductions”)",
      "provided that if such disbursements are in excess of the monies available to the Agent, the Owner agrees to pay such excess promptly upon demand by the Agent.",
    ],
  },
  {
    title: "INDEMNITY",
    paragraphs: [
      "10. The Owner will indemnify and keep indemnified the Agent against all actions, suits, proceedings, claims, demands, costs and expenses whatsoever which may be taken or made against the Agent in the course of his/her duties pursuant to this Agreement provided that such actions, suits, proceedings, claims, costs and expenses do not arise due to any negligent act or omission by the Agent.",
    ],
  },
  {
    title: "COMPLIANCE WITH LAWS",
    paragraphs: [
      "11. The Agent will comply with the Residential Tenancies Act 1997, the Agents Act and all other applicable laws, ordinances and/or regulators in carrying out his/her duties under this Agreement.",
    ],
  },
];

export const PMA_PRIVACY_PARAGRAPHS = [
  "The agent uses personal information collected from and about the Owner to act as the Owner’s Agent and to perform their obligations under this agreement. The agent may also use such information collected to promote the services of the agent and/or seek potential clients.",
  "The agent may disclose information to other parties including media organisations, on the internet, to potential tenants and their advisers, or to clients of the agent both existing and potential, as well as to tradespeople, owners’ corporations, government and statutory bodies and to third parties as requested by law.",
  "The agent will only disclose information to other parties to perform their duties under this agreement; to achieve the purpose specified above as otherwise allowed under the Privacy Act 1988.",
  "If the Owner would like to access this information, they can do so by contacting the Agent at the above address and contact numbers contained in this agreement. The Owner can correct this information if it is inaccurate, incomplete or out of date.",
];

export const PMA_FEE_SCHEDULE: Array<{ heading?: string; lines: string[] }> = [
  {
    heading: "1. Initial letting fee",
    lines: [
      "Equal to 0 weeks rent",
      "Advertisement on flatmates.com.au/sharehousemanagers.com.au/FaceBook/Instagram/Whatsapp",
      "Quick Rent sign “Is This Your New Rental Share House”",
      "Attendance to show prospective tenants",
      "Attendance at commencement and/or final",
      "Processing of commencement inspection",
      "Update of inventory and condition report.",
      "Reference checking",
      "Organise cleaning and repair as necessary",
      "Attend lease signing with new tenants",
      "Lodgement of bond (incoming)",
      "Finalisation of bond (outgoing)",
      "Out of pocket expenses (petties, telephone, stamps, stationery)",
      "Initial inventory preparation fee",
    ],
  },
  {
    lines: ["2. /Renegotiation to secure existing tenants to a new lease 0 % of a week’s rent"],
  },
  {
    lines: ["3. Management fee 10%"],
  },
  {
    lines: ["4. Monthly Statement and accounting fee n/a"],
  },
  {
    lines: ["5. Advertising – included"],
  },
  {
    heading: "6. Residential Tenancy tribunal matters",
    lines: [
      "Lodgement and application fee at cost",
      "Preparation of dispute submission and evidence $100.00",
      "Attendance fee $ 50.00/hr",
    ],
  },
  {
    lines: ["N.B all Charges are plus GST"],
  },
];
