from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def index():
    """Render the main application page."""
    return render_template('index.html')

@app.route('/retro')
def retro():
    """Render the retro-futuristic interface."""
    return render_template('retro.html')

@app.route('/soundscape')
def soundscape():
    """Render the Beyond Sound multisensory sound experience interface."""
    return render_template('soundscape.html')

def main():
    """Run the Flask application."""
    app.run(debug=True, port=5001)

if __name__ == "__main__":
    main()
