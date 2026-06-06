# ParkFinder - Parking Spot Finder App

A modern, responsive parking finder application built with React and Tailwind CSS. Find, book, and manage parking spots near you with an intuitive user interface.

## Features

### 🚗 Core Functionality
- **Search & Filter**: Find parking spots by name, location, type (free/paid), and radius
- **Real-time Availability**: View live availability of parking spots
- **Favorites**: Save your favorite parking locations for quick access
- **Booking System**: Complete booking flow with date, time, and duration selection
- **Payment Integration**: Multiple payment method support (cards, Apple Pay, Google Pay)
- **Receipt Generation**: Detailed booking receipts with all transaction information

### 🎨 User Experience
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
- **Multiple View Modes**: Switch between list and map views
- **Offline Support**: Automatic detection of offline status with cached results
- **User Profiles**: Track your bookings and favorite spots
- **Intuitive Navigation**: Smooth transitions between screens

### 📱 Screens
1. **Login**: Simple authentication screen (demo mode)
2. **Home**: Browse and search parking spots with filters
3. **Detail**: View detailed information about a parking spot
4. **Booking**: Multi-step booking process with date/time selection
5. **Receipt**: Confirmation and receipt display
6. **Profile**: User dashboard with bookings and favorites

## Tech Stack

- **React 18.2** - UI framework
- **Tailwind CSS 3.4** - Styling
- **Vite 5.0** - Build tool and dev server
- **Lucide React** - Icon library
- **Context API** - State management

## Getting Started

### Prerequisites
- Node.js 16+ and npm

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Parking-finder-
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The app will open automatically at `http://localhost:3000`

### Build for Production

```bash
npm run build
```

The production-ready files will be in the `dist` directory.

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
Parking-finder-/
├── src/
│   ├── App.jsx          # Main application component with all screens
│   ├── main.jsx         # Application entry point
│   └── index.css        # Tailwind CSS imports and global styles
├── index.html           # HTML template
├── package.json         # Dependencies and scripts
├── vite.config.js       # Vite configuration
├── tailwind.config.js   # Tailwind CSS configuration
└── postcss.config.js    # PostCSS configuration
```

## Usage

### Demo Login
The app uses a demo authentication system. Use any email and password to login.

### Finding Parking
1. Login to the application
2. Browse available parking spots on the home screen
3. Use the search bar to find specific locations
4. Apply filters for parking type and search radius
5. Click on a parking spot to view details

### Booking a Spot
1. Select a parking spot from the list
2. Click "Book This Spot"
3. Choose your date and time
4. Select parking duration
5. Choose payment method
6. Review and confirm your booking
7. View your receipt

### Managing Favorites
- Click the heart icon on any parking card to add/remove from favorites
- View all favorites in your profile

## Features in Detail

### Search & Filters
- Text search for parking spot names and addresses
- Filter by parking type (all, free, paid)
- Adjust search radius (1-10 miles)

### Pricing
- Transparent pricing display
- 10% service fee on all bookings
- Free cancellation up to 1 hour before booking

### Mock Data
The app includes 6 mock parking spots with various features:
- Downtown Plaza Parking
- City Center Garage
- Street Parking - 5th Ave
- Riverside Parking Lot
- Metro Station Parking
- Park & Walk - Elm Street

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

### Code Structure

The application is built as a single-page application (SPA) with:
- **Context API** for global state management
- **Component-based architecture** with reusable components
- **Screen-based routing** using conditional rendering
- **Responsive design** using Tailwind CSS utilities

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## License

This project is licensed under the MIT License.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
# test
