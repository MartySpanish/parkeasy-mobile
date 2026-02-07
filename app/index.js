// App.js (Expo / React Native version of ParkEasy)

import {
  Accessibility,
  Award,
  Briefcase,
  Building2,
  Car,
  CheckCircle,
  Clock,
  Coffee,
  DollarSign,
  Filter,
  Hotel,
  Landmark,
  LogOut,
  MapPin,
  Menu,
  Navigation,
  Plus,
  Search,
  ShoppingBag,
  Star,
  User,
  X,
  Zap,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

// ---------- Mock data ----------

const belfastDestinations = [
  { id: 'city_hall', name: 'City Hall', icon: Landmark },
  { id: 'victoria_square', name: 'Victoria Square', icon: ShoppingBag },
  { id: 'titanic_quarter', name: 'Titanic Quarter', icon: Landmark },
  { id: 'botanic_gardens', name: 'Botanic Gardens', icon: MapPin },
  { id: 'cathedral_quarter', name: 'Cathedral Quarter', icon: Coffee },
  { id: 'odyssey_arena', name: 'SSE Arena', icon: Building2 },
  { id: 'grand_central', name: 'Grand Central Hotel', icon: Hotel },
  { id: 'city_centre', name: 'City Centre', icon: Briefcase },
];

const mockParkingSpots = [
  {
    id: 1,
    name: 'City Hall Multi-Storey',
    address: '15 Donegall Square North, Belfast BT1 5GS',
    type: 'multi_story_garage',
    pricing: { free: false, hourlyRate: 2.5, dailyMax: 12 },
    available: 24,
    rating: 4.3,
    evCharging: { available: true, ports: 4, speed: '7kW' },
    features: { accessible: true, covered: true, security: true },
    distance: 0.2,
    nearDestinations: ['city_hall', 'city_centre'],
    description: 'Convenient multi-storey car park in the heart of Belfast city centre.',
  },
  {
    id: 2,
    name: 'Victoria Square Car Park',
    address: 'Victoria Square, Belfast BT1 4QG',
    type: 'multi_story_garage',
    pricing: { free: false, hourlyRate: 3.0, dailyMax: 15 },
    available: 156,
    rating: 4.6,
    evCharging: { available: true, ports: 8, speed: '22kW' },
    features: { accessible: true, covered: true, security: true },
    distance: 0.3,
    nearDestinations: ['victoria_square', 'city_centre'],
    description: 'Large shopping centre car park with excellent facilities.',
  },
  {
    id: 3,
    name: 'Titanic Quarter Parking',
    address: 'Queens Road, Belfast BT3 9DT',
    type: 'surface_lot',
    pricing: { free: false, hourlyRate: 2.0, dailyMax: 8 },
    available: 89,
    rating: 4.5,
    evCharging: { available: true, ports: 6, speed: '7kW' },
    features: { accessible: true, covered: false, security: true },
    distance: 1.2,
    nearDestinations: ['titanic_quarter'],
    description: 'Open-air parking near Titanic Belfast visitor attraction.',
  },
  {
    id: 4,
    name: 'Botanic Avenue Street Parking',
    address: 'Botanic Avenue, Belfast BT7 1JL',
    type: 'street',
    pricing: { free: false, hourlyRate: 1.5, dailyMax: 6 },
    available: 12,
    rating: 3.8,
    evCharging: { available: false, ports: 0, speed: null },
    features: { accessible: false, covered: false, security: false },
    distance: 0.8,
    nearDestinations: ['botanic_gardens'],
    description: 'On-street parking near Botanic Gardens and Queen\'s University.',
  },
  {
    id: 5,
    name: 'Cathedral Quarter Car Park',
    address: 'Academy Street, Belfast BT1 2NJ',
    type: 'multi_story_garage',
    pricing: { free: false, hourlyRate: 2.8, dailyMax: 14 },
    available: 45,
    rating: 4.4,
    evCharging: { available: true, ports: 5, speed: '7kW' },
    features: { accessible: true, covered: true, security: true },
    distance: 0.4,
    nearDestinations: ['cathedral_quarter', 'city_centre'],
    description: 'Secure parking in the vibrant Cathedral Quarter.',
  },
  {
    id: 6,
    name: 'Odyssey Pavilion Car Park',
    address: '2 Queen\'s Quay, Belfast BT3 9QQ',
    type: 'surface_lot',
    pricing: { free: false, hourlyRate: 3.5, dailyMax: 18 },
    available: 234,
    rating: 4.7,
    evCharging: { available: true, ports: 10, speed: '22kW' },
    features: { accessible: true, covered: false, security: true },
    distance: 1.5,
    nearDestinations: ['odyssey_arena'],
    description: 'Large car park serving SSE Arena and Odyssey entertainment complex.',
  },
];

// ---------- Main App ----------

export default function App() {
  const [currentView, setCurrentView] = useState('landing');
  const [user, setUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userSubmissions, setUserSubmissions] = useState([]);
  const [filters, setFilters] = useState({
    type: 'all',
    maxPrice: 5,
    evCharging: false,
    accessible: false,
    covered: false,
    free: false,
    sortBy: 'distance',
  });

  // ---------- Handlers ----------

  const handleLogin = (email, password) => {
    setUser({ id: 1, name: email.split('@')[0], email });
    setCurrentView('search');
  };

  const handleSignup = (name, email, password) => {
    setUser({ id: 1, name, email });
    setCurrentView('search');
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentView('landing');
    setMenuOpen(false);
  };

  const handleDestinationSelect = (dest) => {
    setSelectedDestination(dest);
  };

  const handleSubmitReview = (spotId, rating, comment) => {
    console.log('Review submitted:', { spotId, rating, comment });
    setShowReviewForm(false);
    setSelectedSpot(null);
  };

  const handleSubmitSpot = (spotData) => {
    const newSubmission = {
      id: Date.now(),
      ...spotData,
      status: 'pending',
      submittedDate: new Date(),
      pointsEarned: 10,
    };
    setUserSubmissions([...userSubmissions, newSubmission]);
    setShowSubmitForm(false);
  };

  const typeColor = (type) => {
    if (type === 'multi_story_garage') return { backgroundColor: '#dbeafe' };
    if (type === 'surface_lot') return { backgroundColor: '#fef3c7' };
    return { backgroundColor: '#e5e7eb' };
  };

  // ---------- Filtering logic ----------

  const filteredSpots = useMemo(() => {
    return mockParkingSpots
      .filter((spot) => {
        if (selectedDestination && !spot.nearDestinations.includes(selectedDestination.id)) {
          return false;
        }
        if (searchQuery && !spot.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
            !spot.address.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false;
        }
        if (filters.type !== 'all' && spot.type !== filters.type) return false;
        if (filters.free && !spot.pricing.free) return false;
        if (filters.evCharging && !spot.evCharging.available) return false;
        if (filters.accessible && !spot.features.accessible) return false;
        if (filters.covered && !spot.features.covered) return false;
        if (spot.pricing.hourlyRate > filters.maxPrice) return false;
        return true;
      })
      .sort((a, b) => {
        if (filters.sortBy === 'rating') {
          return b.rating - a.rating;
        }
        return a.distance - b.distance;
      });
  }, [filters, searchQuery, selectedDestination]);

  // ---------- Screens ----------

  const LandingPage = () => (
    <View style={styles.fullScreenCenter}>
      <Text style={styles.landingTitle}>
        Park<Text style={styles.logoAccent}>Easy</Text>
      </Text>
      <Text style={styles.landingSubtitle}>Belfast's Smart Parking Finder</Text>
      <Text style={styles.landingDescription}>
        Find parking near Belfast's top destinations, with EV charging,
        real-time availability and more.
      </Text>
      <View style={styles.landingButtonsRow}>
        <PrimaryButton label="Get Started" onPress={() => setCurrentView('login')} />
        <SecondaryButton label="Sign Up Free" onPress={() => setCurrentView('signup')} />
      </View>
      <View style={styles.landingFeatureRow}>
        <FeaturePill icon={MapPin} label="500+ locations" />
        <FeaturePill icon={Zap} label="EV charging" />
        <FeaturePill icon={Star} label="4.6★ community" />
      </View>
    </View>
  );

  const LoginPage = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    return (
      <View style={styles.authScreen}>
        <Text style={styles.authTitle}>Welcome back</Text>
        <View style={styles.authCard}>
          <TextInput
            style={styles.authInput}
            placeholder="Email address"
            placeholderTextColor="#6b7280"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.authInput}
            placeholder="Password"
            placeholderTextColor="#6b7280"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <PrimaryButton label="Sign in" onPress={() => handleLogin(email, password)} />
          <Text style={styles.authSwitchText}>
            Don't have an account?{' '}
            <Text style={styles.authSwitchLink} onPress={() => setCurrentView('signup')}>
              Sign up
            </Text>
          </Text>
        </View>
      </View>
    );
  };

  const SignupPage = () => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    return (
      <View style={styles.authScreen}>
        <Text style={styles.authTitle}>Join ParkEasy</Text>
        <View style={styles.authCard}>
          <TextInput
            style={styles.authInput}
            placeholder="Full name"
            placeholderTextColor="#6b7280"
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={styles.authInput}
            placeholder="Email address"
            placeholderTextColor="#6b7280"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.authInput}
            placeholder="Create password"
            placeholderTextColor="#6b7280"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <PrimaryButton label="Create account" onPress={() => handleSignup(name, email, password)} />
          <Text style={styles.authSwitchText}>
            Already have an account?{' '}
            <Text style={styles.authSwitchLink} onPress={() => setCurrentView('login')}>
              Sign in
            </Text>
          </Text>
        </View>
      </View>
    );
  };

  const SearchPage = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Text style={styles.logoText}>
          Park<Text style={styles.logoAccent}>Easy</Text>
        </Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.submitSpotButton} onPress={() => setShowSubmitForm(true)}>
            <Plus size={16} color="#eab308" />
            <Text style={styles.submitSpotText}>Submit spot</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuButton} onPress={() => setMenuOpen(!menuOpen)}>
            <Menu size={20} color="#e5e7eb" />
          </TouchableOpacity>
        </View>
      </View>

      {menuOpen && (
        <View style={styles.menuSheet}>
          <View style={styles.menuUserRow}>
            <User size={20} color="#e5e7eb" />
            <View>
              <Text style={styles.menuUserName}>{user?.name}</Text>
              <Text style={styles.menuPoints}>{userSubmissions.length * 10} points</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setCurrentView('submissions');
              setMenuOpen(false);
            }}
          >
            <Award size={18} color="#eab308" />
            <Text style={styles.menuItemText}>My submissions</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
            <LogOut size={18} color="#fca5a5" />
            <Text style={[styles.menuItemText, { color: '#fecaca' }]}>Logout</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.searchScroll}>
        <Text style={styles.sectionTitle}>Find parking near…</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: 12 }}
        >
          {belfastDestinations.map((dest) => {
            const Icon = dest.icon;
            const active = selectedDestination?.id === dest.id;
            return (
              <TouchableOpacity
                key={dest.id}
                style={[
                  styles.destChip,
                  active && styles.destChipActive,
                ]}
                onPress={() =>
                  handleDestinationSelect(
                    active ? null : { id: dest.id, name: dest.name }
                  )
                }
              >
                <Icon size={18} color={active ? '#4f46e5' : '#e5e7eb'} />
                <Text
                  style={[
                    styles.destChipText,
                    active && styles.destChipTextActive,
                  ]}
                >
                  {dest.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.searchBar}>
          <Search size={18} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by location, parking name, or attraction…"
            placeholderTextColor="#6b7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <Pressable onPress={() => setShowFilters(!showFilters)} style={styles.filterIcon}>
            <Filter size={18} color="#e5e7eb" />
          </Pressable>
        </View>

        {showFilters && (
          <View style={styles.filtersCard}>
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Type</Text>
              <FilterChip
                label="All"
                active={filters.type === 'all'}
                onPress={() => setFilters({ ...filters, type: 'all' })}
              />
              <FilterChip
                label="Multi-story"
                active={filters.type === 'multi_story_garage'}
                onPress={() => setFilters({ ...filters, type: 'multi_story_garage' })}
              />
              <FilterChip
                label="Surface"
                active={filters.type === 'surface_lot'}
                onPress={() => setFilters({ ...filters, type: 'surface_lot' })}
              />
              <FilterChip
                label="Street"
                active={filters.type === 'street'}
                onPress={() => setFilters({ ...filters, type: 'street' })}
              />
            </View>

            <View style={styles.filterRowSpace}>
              <Text style={styles.filterLabel}>Max price (hr)</Text>
              <Text style={styles.filterValue}>£{filters.maxPrice}</Text>
            </View>

            <View style={styles.toggleRow}>
              <TogglePill
                label="EV charging"
                icon={Zap}
                active={filters.evCharging}
                onPress={() => setFilters({ ...filters, evCharging: !filters.evCharging })}
              />
              <TogglePill
                label="Accessible"
                icon={Accessibility}
                active={filters.accessible}
                onPress={() => setFilters({ ...filters, accessible: !filters.accessible })}
              />
              <TogglePill
                label="Covered"
                icon={Building2}
                active={filters.covered}
                onPress={() => setFilters({ ...filters, covered: !filters.covered })}
              />
              <TogglePill
                label="Free"
                icon={CheckCircle}
                active={filters.free}
                onPress={() => setFilters({ ...filters, free: !filters.free })}
              />
            </View>
          </View>
        )}

        <Text style={styles.resultsTitle}>
          {filteredSpots.length} spot
          {filteredSpots.length !== 1 ? 's' : ''}{' '}
          {selectedDestination ? `near ${selectedDestination.name}` : 'around Belfast'}
        </Text>

        <View style={{ gap: 10, marginBottom: 40 }}>
          {filteredSpots.map((spot) => (
            <TouchableOpacity
              key={spot.id}
              style={styles.card}
              onPress={() => setSelectedSpot(spot)}
            >
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitle}>{spot.name}</Text>
                <View style={[styles.typeBadge, typeColor(spot.type)]}>
                  {spot.type === 'multi_story_garage' && (
                    <Building2 size={12} color="#111827" />
                  )}
                  {spot.type === 'surface_lot' && <Car size={12} color="#111827" />}
                  {spot.type === 'street' && <MapPin size={12} color="#111827" />}
                  <Text style={styles.typeBadgeText}>
                    {spot.type.replace(/_/g, ' ')}
                  </Text>
                </View>
              </View>

              <View style={styles.addressRow}>
                <MapPin size={14} color="#9ca3af" />
                <Text style={styles.addressText}>{spot.address}</Text>
              </View>

              <View style={styles.badgeRow}>
                {spot.evCharging.available && (
                  <View style={[styles.badge, styles.badgeEv]}>
                    <Zap size={12} color="#eab308" />
                    <Text style={styles.badgeText}>EV</Text>
                  </View>
                )}
                {spot.features.accessible && (
                  <View style={[styles.badge, styles.badgeAccessible]}>
                    <Accessibility size={12} color="#3b82f6" />
                    <Text style={styles.badgeText}>Accessible</Text>
                  </View>
                )}
                {spot.features.covered && (
                  <View style={[styles.badge, styles.badgeCovered]}>
                    <Building2 size={12} color="#8b5cf6" />
                    <Text style={styles.badgeText}>Covered</Text>
                  </View>
                )}
                {spot.pricing.free && (
                  <View style={[styles.badge, styles.badgeFree]}>
                    <Text style={styles.badgeText}>FREE</Text>
                  </View>
                )}
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Star size={14} color="#facc15" />
                  <Text style={styles.statText}>{spot.rating}</Text>
                </View>
                <View style={styles.statItem}>
                  <Clock size={14} color="#9ca3af" />
                  <Text style={styles.statText}>{spot.available} spots</Text>
                </View>
                <View style={styles.statItem}>
                  <DollarSign size={14} color="#22c55e" />
                  <Text style={styles.priceText}>
                    {spot.pricing.free
                      ? 'FREE'
                      : `£${spot.pricing.hourlyRate}/hr`}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <SpotDetailsModal
        spot={selectedSpot}
        visible={!!selectedSpot}
        onClose={() => setSelectedSpot(null)}
        onReview={() => setShowReviewForm(true)}
      />

      {selectedSpot && (
        <ReviewForm
          visible={showReviewForm}
          spot={selectedSpot}
          onClose={() => setShowReviewForm(false)}
          onSubmit={handleSubmitReview}
        />
      )}

      <SubmitSpotForm
        visible={showSubmitForm}
        onClose={() => setShowSubmitForm(false)}
        onSubmit={handleSubmitSpot}
        destinations={belfastDestinations}
      />
    </View>
  );

  const SubmissionsPage = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => setCurrentView('search')}
        >
          <Text style={{ color: '#e5e7eb' }}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.logoText}>My submissions</Text>
      </View>

      <ScrollView contentContainerStyle={styles.searchScroll}>
        <View style={styles.pointsCard}>
          <Award size={28} color="#eab308" />
          <View>
            <Text style={styles.pointsLabel}>Total points</Text>
            <Text style={styles.pointsValue}>{userSubmissions.length * 10}</Text>
          </View>
        </View>

        {userSubmissions.length === 0 ? (
          <View style={styles.emptyState}>
            <MapPin size={48} color="#4b5563" />
            <Text style={styles.emptyTitle}>No submissions yet</Text>
            <Text style={styles.emptyText}>
              Submit parking spots around Belfast and earn points for helping the
              community.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {userSubmissions.map((sub) => (
              <View key={sub.id} style={styles.submissionCard}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle}>{sub.name}</Text>
                  <View style={styles.pendingBadge}>
                    <Text style={styles.pendingBadgeText}>{sub.status}</Text>
                  </View>
                </View>
                <Text style={styles.addressText}>{sub.address}</Text>
                <View style={styles.statsRow}>
                  <Text style={styles.subMeta}>
                    {sub.submittedDate.toLocaleDateString()}
                  </Text>
                  <Text style={styles.subMeta}>{sub.pointsEarned} pts</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );

  // ---------- Root switch ----------

  let Screen = LandingPage;
  if (currentView === 'login') Screen = LoginPage;
  if (currentView === 'signup') Screen = SignupPage;
  if (currentView === 'search') Screen = SearchPage;
  if (currentView === 'submissions') Screen = SubmissionsPage;

  return (
    <SafeAreaView style={styles.appRoot}>
      <Screen />
    </SafeAreaView>
  );
}

// ---------- Reusable components ----------

const PrimaryButton = ({ label, onPress }) => (
  <TouchableOpacity style={styles.primaryButton} onPress={onPress}>
    <Text style={styles.primaryButtonText}>{label}</Text>
  </TouchableOpacity>
);

const SecondaryButton = ({ label, onPress }) => (
  <TouchableOpacity style={styles.secondaryButton} onPress={onPress}>
    <Text style={styles.secondaryButtonText}>{label}</Text>
  </TouchableOpacity>
);

const FeaturePill = ({ icon: Icon, label }) => (
  <View style={styles.featurePill}>
    <Icon size={16} color="#e5e7eb" />
    <Text style={styles.featurePillText}>{label}</Text>
  </View>
);

const FilterChip = ({ label, active, onPress }) => (
  <TouchableOpacity
    style={[styles.filterChip, active && styles.filterChipActive]}
    onPress={onPress}
  >
    <Text
      style={[styles.filterChipText, active && styles.filterChipTextActive]}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

const TogglePill = ({ label, icon: Icon, active, onPress }) => (
  <TouchableOpacity
    style={[styles.togglePill, active && styles.togglePillActive]}
    onPress={onPress}
  >
    <Icon size={14} color={active ? '#a855f7' : '#e5e7eb'} />
    <Text
      style={[styles.togglePillText, active && styles.togglePillTextActive]}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

const SpotDetailsModal = ({ spot, visible, onClose, onReview }) => {
  if (!spot) return null;
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <X size={20} color="#e5e7eb" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>{spot.name}</Text>
          <View style={styles.addressRow}>
            <MapPin size={16} color="#9ca3af" />
            <Text style={styles.addressText}>{spot.address}</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Star size={16} color="#facc15" />
              <Text style={styles.statText}>{spot.rating}</Text>
            </View>
            <View style={styles.statItem}>
              <Clock size={16} color="#9ca3af" />
              <Text style={styles.statText}>{spot.available} available</Text>
            </View>
            <View style={styles.statItem}>
              <DollarSign size={16} color="#22c55e" />
              <Text style={styles.priceText}>
                {spot.pricing.free ? 'FREE' : `£${spot.pricing.hourlyRate}/hr`}
              </Text>
            </View>
          </View>

          {spot.description && (
            <Text style={styles.modalDescription}>{spot.description}</Text>
          )}

          {spot.evCharging.available && (
            <View style={styles.evBox}>
              <View style={styles.badgeRow}>
                <Zap size={16} color="#eab308" />
                <Text style={styles.evBoxTitle}>EV charging</Text>
              </View>
              <Text style={styles.evBoxText}>
                {spot.evCharging.ports} ports · {spot.evCharging.speed}
              </Text>
            </View>
          )}

          <View style={styles.spotActionsRow}>
            <TouchableOpacity style={styles.directionsButton}>
              <Navigation size={16} color="#22c55e" />
              <Text style={styles.directionsText}>Get directions</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.reviewButton} onPress={onReview}>
              <Star size={16} color="#4f46e5" />
              <Text style={styles.reviewButtonText}>Leave review</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const ReviewForm = ({ visible, spot, onClose, onSubmit }) => {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <X size={20} color="#e5e7eb" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Review {spot.name}</Text>
          <Text style={styles.modalSubTitle}>
            Share your experience to help other drivers.
          </Text>

          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((v) => (
              <TouchableOpacity key={v} onPress={() => setRating(v)}>
                <Star
                  size={28}
                  color="#eab308"
                  fill={v <= rating ? '#eab308' : 'transparent'}
                />
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={styles.textArea}
            multiline
            numberOfLines={4}
            placeholder="Tell us about parking, safety, lighting, etc."
            placeholderTextColor="#6b7280"
            value={comment}
            onChangeText={setComment}
          />

          <PrimaryButton
            label="Submit review"
            onPress={() => {
              onSubmit(spot.id, rating, comment);
              setComment('');
              setRating(5);
            }}
          />
        </View>
      </View>
    </Modal>
  );
};

const SubmitSpotForm = ({ visible, onClose, onSubmit, destinations }) => {
  const [form, setForm] = useState({
    name: '',
    address: '',
    nearDestination: '',
    type: 'surface_lot',
    free: false,
    hourlyRate: '',
    evCharging: false,
    accessible: false,
    covered: false,
    description: '',
  });

  const update = (patch) => setForm({ ...form, ...patch });

  const handleSubmit = () => {
    onSubmit(form);
    setForm({
      name: '',
      address: '',
      nearDestination: '',
      type: 'surface_lot',
      free: false,
      hourlyRate: '',
      evCharging: false,
      accessible: false,
      covered: false,
      description: '',
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <ScrollView
          contentContainerStyle={[styles.modalCard, { paddingBottom: 24 }]}
          style={{ backgroundColor: '#020617', borderRadius: 20 }}
        >
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <X size={20} color="#e5e7eb" />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Submit new parking spot</Text>
          <Text style={styles.modalSubTitle}>
            Help grow the Belfast parking map and earn points.
          </Text>

          <TextInput
            style={styles.authInput}
            placeholder="Parking spot name"
            placeholderTextColor="#6b7280"
            value={form.name}
            onChangeText={(v) => update({ name: v })}
          />
          <TextInput
            style={styles.authInput}
            placeholder="Address"
            placeholderTextColor="#6b7280"
            value={form.address}
            onChangeText={(v) => update({ address: v })}
          />
          <TextInput
            style={styles.authInput}
            placeholder="Near which destination? (e.g. City Hall)"
            placeholderTextColor="#6b7280"
            value={form.nearDestination}
            onChangeText={(v) => update({ nearDestination: v })}
          />
          <TextInput
            style={styles.authInput}
            placeholder="Hourly rate (leave blank if free)"
            placeholderTextColor="#6b7280"
            keyboardType="numeric"
            value={form.hourlyRate}
            onChangeText={(v) => update({ hourlyRate: v })}
          />

          <View style={styles.toggleRow}>
            <TogglePill
              label="Free"
              icon={CheckCircle}
              active={form.free}
              onPress={() => update({ free: !form.free })}
            />
            <TogglePill
              label="EV charging"
              icon={Zap}
              active={form.evCharging}
              onPress={() => update({ evCharging: !form.evCharging })}
            />
            <TogglePill
              label="Accessible"
              icon={Accessibility}
              active={form.accessible}
              onPress={() => update({ accessible: !form.accessible })}
            />
            <TogglePill
              label="Covered"
              icon={Building2}
              active={form.covered}
              onPress={() => update({ covered: !form.covered })}
            />
          </View>

          <TextInput
            style={styles.textArea}
            multiline
            numberOfLines={4}
            placeholder="Any useful details (restrictions, lighting, safety, etc.)"
            placeholderTextColor="#6b7280"
            value={form.description}
            onChangeText={(v) => update({ description: v })}
          />

          <PrimaryButton label="Submit spot" onPress={handleSubmit} />
        </ScrollView>
      </View>
    </Modal>
  );
};

// ---------- Styles ----------

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: '#020617',
  },
  fullScreenCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  landingTitle: {
    fontSize: 40,
    fontWeight: '900',
    color: '#e5e7eb',
  },
  logoAccent: {
    color: '#6366f1',
  },
  landingSubtitle: {
    marginTop: 8,
    fontSize: 18,
    color: '#a5b4fc',
  },
  landingDescription: {
    marginTop: 12,
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  landingButtonsRow: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  landingFeatureRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 20,
    justifyContent: 'center',
    gap: 8,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#020617',
  },
  featurePillText: {
    marginLeft: 6,
    color: '#e5e7eb',
    fontSize: 12,
  },
  primaryButton: {
    backgroundColor: '#4f46e5',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  primaryButtonText: {
    color: '#f9fafb',
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#4f46e5',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  secondaryButtonText: {
    color: '#e5e7eb',
    fontWeight: '600',
  },
  authScreen: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  authTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#e5e7eb',
    marginBottom: 16,
    textAlign: 'center',
  },
  authCard: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  authInput: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e5e7eb',
    fontSize: 14,
    marginBottom: 8,
  },
  authSwitchText: {
    marginTop: 8,
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
  },
  authSwitchLink: {
    color: '#a5b4fc',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#111827',
    justifyContent: 'space-between',
  },
  logoText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#e5e7eb',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitSpotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#eab308',
    backgroundColor: 'rgba(234,179,8,0.15)',
    gap: 4,
  },
  submitSpotText: {
    color: '#eab308',
    fontSize: 12,
    fontWeight: '600',
  },
  menuButton: {
    padding: 8,
    borderRadius: 999,
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  menuSheet: {
    marginHorizontal: 16,
    marginTop: 6,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#020617',
  },
  menuUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#111827',
    marginBottom: 8,
  },
  menuUserName: {
    color: '#e5e7eb',
    fontWeight: '600',
  },
  menuPoints: {
    color: '#eab308',
    fontSize: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  menuItemText: {
    color: '#e5e7eb',
    fontSize: 14,
  },
  searchScroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  sectionTitle: {
    color: '#e5e7eb',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  destChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    marginRight: 8,
    backgroundColor: '#020617',
  },
  destChipActive: {
    backgroundColor: '#e0e7ff',
    borderColor: '#4f46e5',
  },
  destChipText: {
    marginLeft: 6,
    color: '#e5e7eb',
    fontSize: 13,
  },
  destChipTextActive: {
    color: '#111827',
    fontWeight: '600',
  },
  searchBar: {
    marginTop: 4,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#020617',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    color: '#e5e7eb',
    fontSize: 14,
  },
  filterIcon: {
    paddingLeft: 8,
  },
  filtersCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#020617',
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  filterRowSpace: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  filterLabel: {
    color: '#9ca3af',
    fontSize: 12,
    marginRight: 4,
  },
  filterValue: {
    color: '#e5e7eb',
    fontSize: 13,
  },
  filterChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
  },
  filterChipActive: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  filterChipText: {
    color: '#e5e7eb',
    fontSize: 12,
  },
  filterChipTextActive: {
    color: '#f9fafb',
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  togglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    gap: 4,
  },
  togglePillActive: {
    backgroundColor: 'rgba(168,85,247,0.15)',
    borderColor: '#a855f7',
  },
  togglePillText: {
    color: '#e5e7eb',
    fontSize: 12,
  },
  togglePillTextActive: {
    color: '#e0d5ff',
    fontWeight: '600',
  },
  resultsTitle: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 16,
    padding: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    color: '#e5e7eb',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 3,
  },
  typeBadgeText: {
    color: '#111827',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  addressText: {
    color: '#9ca3af',
    fontSize: 13,
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 3,
  },
  badgeEv: {
    backgroundColor: 'rgba(234,179,8,0.15)',
  },
  badgeAccessible: {
    backgroundColor: 'rgba(59,130,246,0.15)',
  },
  badgeCovered: {
    backgroundColor: 'rgba(139,92,246,0.15)',
  },
  badgeFree: {
    backgroundColor: 'rgba(34,197,94,0.15)',
  },
  badgeText: {
    color: '#e5e7eb',
    fontSize: 10,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    color: '#e5e7eb',
    fontSize: 13,
  },
  priceText: {
    color: '#22c55e',
    fontSize: 13,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#020617',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    maxWidth: 500,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  modalClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 8,
    borderRadius: 999,
    backgroundColor: '#1f2937',
    zIndex: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#e5e7eb',
    marginBottom: 8,
  },
  modalSubTitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 16,
  },
  modalDescription: {
    color: '#d1d5db',
    fontSize: 14,
    marginTop: 12,
    lineHeight: 20,
  },
  evBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(234,179,8,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.3)',
  },
  evBoxTitle: {
    color: '#eab308',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  evBoxText: {
    color: '#e5e7eb',
    fontSize: 13,
    marginTop: 4,
  },
  spotActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  directionsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#22c55e',
    gap: 6,
  },
  directionsText: {
    color: '#22c55e',
    fontWeight: '600',
  },
  reviewButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#4f46e5',
    gap: 6,
  },
  reviewButtonText: {
    color: '#f9fafb',
    fontWeight: '600',
  },
  starRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 16,
  },
  textArea: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#e5e7eb',
    fontSize: 14,
    marginBottom: 16,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  backButton: {
    padding: 8,
  },
  pointsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(234,179,8,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(234,179,8,0.3)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    gap: 12,
  },
  pointsLabel: {
    color: '#9ca3af',
    fontSize: 13,
  },
  pointsValue: {
    color: '#eab308',
    fontSize: 24,
    fontWeight: '800',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    color: '#e5e7eb',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
  },
  submissionCard: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 16,
    padding: 12,
  },
  pendingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(234,179,8,0.15)',
  },
  pendingBadgeText: {
    color: '#eab308',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  subMeta: {
    color: '#6b7280',
    fontSize: 12,
  },
});