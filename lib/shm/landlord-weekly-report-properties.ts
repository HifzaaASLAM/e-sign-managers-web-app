export type LandlordWeeklyPropertyRow = {
  property_name: string;
  landlord_name: string;
  landlord_email: string;
  total_rooms: string;
};

/**
 * Property / landlord roster for the weekly report creator form.
 * Selecting a property fills landlord, email, and total rooms.
 */
export const LWR_PROPERTY_LANDLORDS: LandlordWeeklyPropertyRow[] = [
  {
    property_name: "12 King St Brunswick",
    landlord_name: "chilli Patel",
    landlord_email: "team@digitechdev.com",
    total_rooms: "6",
  },
  {
    property_name: "52 Glengarry Ave Burwood",
    landlord_name: "Jordan Remzi",
    landlord_email: "jordanremzij@gmail.com",
    total_rooms: "10",
  },
  {
    property_name: "102 North Road Newport",
    landlord_name: "Jordan Remzi",
    landlord_email: "jordanremzij@gmail.com",
    total_rooms: "9",
  },
  {
    property_name: "26 Eucumbene Road Manor Lake",
    landlord_name: "Cale Ziola",
    landlord_email: "tech@dentequip.com.au",
    total_rooms: "5",
  },
  {
    property_name: "1/17 SHADY GROVE, NUNAWADING",
    landlord_name: "Dr. Omaira",
    landlord_email: "omaira14@yahoo.com",
    total_rooms: "3",
  },
  {
    property_name: "8 Rafa Court, Maribyrnong",
    landlord_name: "Marco Vargas",
    landlord_email: "marco@marvarcor.com",
    total_rooms: "3",
  },
  {
    property_name: "2 Studley Street, Mulgrave",
    landlord_name: "Girish Ravi Nair",
    landlord_email: "findgns@gmail.com",
    total_rooms: "5",
  },
  {
    property_name: "17 Cornerstone Crescent, South Morang",
    landlord_name: "Sikhangezile Dhliwayo",
    landlord_email: "skhandlo@gmail.com",
    total_rooms: "3",
  },
  {
    property_name: "3/13 Ridley Station Albion",
    landlord_name: "Adams HB",
    landlord_email: "adam.hb.property@gmail.com",
    total_rooms: "2",
  },
  {
    property_name: "12/13 Ridley Station Albion",
    landlord_name: "Adams HB",
    landlord_email: "adam.hb.property@gmail.com",
    total_rooms: "3",
  },
  {
    property_name: "16/2 Ambrose Treacy Drive, Bundoora",
    landlord_name: "Quoc Dat Trieu (Daniel)",
    landlord_email: "trieuquocdat196@gmail.com",
    total_rooms: "5",
  },
];
