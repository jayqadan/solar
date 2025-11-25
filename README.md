# Solar System Sky Viewer

An interactive 3D solar system viewer that allows you to select any planet and view the sky from that location. Built with Three.js, featuring realistic relative distances and planet sizes based on actual astronomical data.

## Features

- 🌍 **View from Any Planet**: Select any celestial body in our solar system and see the sky from its perspective
- 📏 **Realistic Scale**: All distances and planet sizes are based on actual astronomical data (scaled for visibility)
- 🎨 **Realistic Materials**: Each planet has unique materials and colors matching their real appearance
- 🌌 **Beautiful Starfield**: Immersive starfield background with thousands of stars
- 🔄 **Dynamic Orbits**: Planets orbit the Sun with realistic relative speeds
- ⚙️ **Interactive Controls**:
  - Rotate view with left-click drag
  - Pan view with right-click drag
  - Zoom with mouse wheel
  - Adjustable distance scale
  - Toggle orbits and labels

## Astronomical Data

All planetary data is based on real measurements:

| Planet  | Radius (km) | Distance from Sun (AU) |
|---------|-------------|------------------------|
| Sun     | 696,000     | 0                      |
| Mercury | 2,439.7     | 0.387                  |
| Venus   | 6,051.8     | 0.723                  |
| Earth   | 6,371       | 1.0                    |
| Mars    | 3,389.5     | 1.524                  |
| Jupiter | 69,911      | 5.203                  |
| Saturn  | 58,232      | 9.537                  |
| Uranus  | 25,362      | 19.191                 |
| Neptune | 24,622      | 30.069                 |

*Note: 1 AU (Astronomical Unit) = 149.6 million km (Earth-Sun distance)*

## Installation

### Option 1: Simple HTTP Server

```bash
# Using Python 3
python3 -m http.server 8000

# Using Node.js
npx serve .
```

Then open `http://localhost:8000` in your browser.

### Option 2: npm

```bash
npm install
npm start
```

## Usage

1. **Select a Location**: Use the dropdown menu to choose which celestial body you want to view from
2. **Adjust Distance Scale**: Use the slider to zoom in/out of the solar system
3. **Toggle Orbits**: Show or hide the orbital paths of planets
4. **Toggle Labels**: Show or hide planet name labels
5. **Navigate the View**:
   - **Left-click + drag**: Rotate the view around
   - **Right-click + drag**: Pan the view
   - **Scroll wheel**: Zoom in and out

## Technical Details

### Scale Factors

To make the solar system visible and navigable, we apply two scaling factors:

1. **Distance Scale**: 1 AU = 100 units in the 3D scene
2. **Size Scale**: Planet radii × 0.001 to make smaller planets visible

This ensures that:
- Planets are large enough to see
- Distances are small enough to navigate
- Relative proportions remain accurate

### Technologies Used

- **Three.js**: 3D rendering engine
- **OrbitControls**: Camera control system
- **Vanilla JavaScript**: Core application logic
- **HTML5/CSS3**: User interface

## Project Structure

```
solar/
├── index.html      # Main HTML structure
├── main.js         # Three.js application and solar system logic
├── style.css       # Styling and UI design
├── package.json    # Project metadata and dependencies
└── README.md       # This file
```

## Future Enhancements

Potential improvements:
- Add moons for planets
- Include asteroid belt
- Real texture maps from NASA
- Time controls to speed up/slow down orbits
- Display current date and planet positions
- Add dwarf planets (Pluto, Ceres, etc.)
- Spacecraft and probe positions
- More detailed planet information
- Mobile touch controls optimization

## Educational Value

This viewer helps understand:
- The vast distances in our solar system
- Relative sizes of planets
- How the sky looks different from each planet
- Orbital mechanics and planetary motion
- Scale of our cosmic neighborhood

## Browser Compatibility

Works best on modern browsers with WebGL support:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## License

MIT License - Feel free to use and modify!

## Credits

Built with astronomical data from NASA and JPL planetary databases.

---

Enjoy exploring our solar system! 🚀🌌
