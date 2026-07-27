export const carlosCasares = {
  id: "carlos-casares",
  label: "Carlos Casares",
  pin: { lat: -35.62, lng: -61.36 },
  preview: {
    image: "/docs/argentina/carlos-casares/1.JPG",
    blurb: "Discovering the world of meat, dairy, and arable farming",
  },
  gallery: Array.from({ length: 18 }, (_, index) => ({
    image: `/docs/argentina/carlos-casares/${index + 1}.JPG`,
    caption: "",
  })),
};
