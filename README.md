# IoT Intrusion Detection System

A real-time intrusion detection platform for IoT networks using machine learning.

The system analyses network traffic, classifies observations as normal or malicious, identifies possible attack types, and presents results through an interactive monitoring dashboard.

The project uses the **RT-IoT2022** dataset from the UCI Machine Learning Repository.

---

## Project Objectives

The project is divided into two main parts:

### Machine Learning

* Analyse and preprocess the RT-IoT2022 dataset
* Detect normal and malicious network traffic
* Compare several classification models
* Select and save the best-performing model
* Predict the attack type when possible
* Explain model predictions using feature importance

### Software Engineering

* Capture or simulate network traffic
* Extract features from network flows
* Send observations to the trained model
* Display predictions in real time
* Store detected attacks and alerts
* Provide an interface for testing individual observations
* Present model performance and dataset analysis

---

## Main Features

* Real-time network monitoring
* Binary classification: normal or attack
* Multiclass attack classification
* Live intrusion alerts
* Interactive attack timeline
* IoT network topology visualization
* Searchable and filterable alert history
* CSV observation testing
* Manual observation testing
* Model comparison dashboard
* Confusion matrix visualization
* Feature importance visualization
* Prediction confidence
* Dark and light themes
* Responsive interface

---

## System Architecture

```text
IoT Devices / Traffic Simulator
              |
              v
      Packet Capture Service
              |
              v
       Flow Feature Extraction
              |
              v
      FastAPI Prediction API
              |
        Machine Learning Model
              |
              v
       Database and Alerts
              |
              v
        React Web Dashboard
```

---

## Technology Stack

### Frontend

* React
* TypeScript
* Vite
* Tailwind CSS
* shadcn/ui
* Radix UI
* TanStack Query
* Zustand
* Apache ECharts
* Sigma.js
* TanStack Table
* TanStack Virtual
* React Hook Form
* Zod
* Motion

### Backend

* Python
* FastAPI
* Pydantic
* SQLAlchemy
* WebSockets or Server-Sent Events
* Scapy or PyShark
* PostgreSQL or SQLite

### Machine Learning

* Pandas
* NumPy
* Scikit-learn
* XGBoost
* Imbalanced-learn
* Matplotlib
* Joblib
* SHAP

### Development and Deployment

* Docker
* Docker Compose
* GitHub Actions
* Pytest
* Vitest
* ESLint
* Prettier

---

## Machine-Learning Models

The project compares several classification algorithms:

* Logistic Regression
* Decision Tree
* Random Forest
* HistGradientBoosting
* XGBoost

The models are evaluated using:

* Accuracy
* Precision
* Recall
* F1-score
* Macro F1-score
* Weighted F1-score
* Confusion matrix
* Training time
* Prediction time

Accuracy is not used alone because the dataset may contain imbalanced attack classes.

---

## Application Pages

### Live Overview

Displays:

* Current network status
* Number of active devices
* Traffic rate
* Detected attacks
* Alert severity
* Live attack timeline
* Protocol distribution

### Alerts

Provides:

* Searchable alert table
* Filtering by attack type
* Filtering by severity
* Filtering by protocol
* Filtering by device
* Alert details
* Model confidence
* Feature values
* Prediction explanation

### Network Topology

Displays:

* IoT devices
* Network connections
* Suspicious devices
* Malicious traffic paths
* Device risk levels

### Model Analysis

Displays:

* Model comparison
* Evaluation metrics
* Confusion matrices
* Feature importance
* Class distribution
* Training results

### Observation Testing

Allows users to:

* Upload a CSV observation
* Select an existing test observation
* Enter observation values manually
* Run the trained model
* View the predicted class
* View confidence scores
* View the most important features

---

## Project Structure

```text
iot-intrusion-detection/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── features/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── stores/
│   │   ├── types/
│   │   └── utils/
│   ├── package.json
│   └── vite.config.ts
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── database/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   ├── tests/
│   └── pyproject.toml
│
├── machine-learning/
│   ├── notebooks/
│   ├── src/
│   │   ├── data/
│   │   ├── preprocessing/
│   │   ├── training/
│   │   ├── evaluation/
│   │   └── inference/
│   ├── models/
│   ├── results/
│   └── tests/
│
├── data/
│   ├── raw/
│   ├── processed/
│   └── samples/
│
├── simulator/
│   ├── traffic_generator.py
│   └── attack_scenarios/
│
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

---

## Installation

### Requirements

* Node.js 20 or later
* Python 3.11 or later
* Git
* Docker and Docker Compose, optional

Clone the repository:

```bash
git clone https://github.com/your-username/iot-intrusion-detection.git
cd iot-intrusion-detection
```

---

## Backend Setup

```bash
cd backend

python -m venv .venv

source .venv/bin/activate
```

On Windows:

```powershell
.venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the API:

```bash
uvicorn app.main:app --reload
```

The API will be available at:

```text
http://localhost:8000
```

Interactive API documentation:

```text
http://localhost:8000/docs
```

---

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at:

```text
http://localhost:5173
```

---

## Machine-Learning Setup

Place the RT-IoT2022 dataset inside:

```text
data/raw/RT_IOT2022.csv
```

Run data preprocessing:

```bash
python machine-learning/src/preprocessing/preprocess.py
```

Train and compare the models:

```bash
python machine-learning/src/training/train.py
```

Evaluate the trained models:

```bash
python machine-learning/src/evaluation/evaluate.py
```

The selected model and preprocessing pipeline will be saved inside:

```text
machine-learning/models/
```

---

## Running with Docker

```bash
docker compose up --build
```

The services will be available at:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:8000
API docs: http://localhost:8000/docs
```

---

## API Endpoints

```text
POST /api/predictions
```

Predict a single network observation.

```text
POST /api/predictions/file
```

Upload a CSV file for prediction.

```text
GET /api/alerts
```

Retrieve detected intrusion alerts.

```text
GET /api/alerts/{id}
```

Retrieve detailed information about an alert.

```text
GET /api/dashboard/summary
```

Retrieve dashboard statistics.

```text
GET /api/models/metrics
```

Retrieve model evaluation results.

```text
WS /api/live
```

Receive live traffic and intrusion updates.

---

## Example Prediction

Request:

```json
{
  "proto": "tcp",
  "service": "http",
  "duration": 1.45,
  "src_bytes": 850,
  "dst_bytes": 320,
  "packet_rate": 42.6
}
```

Response:

```json
{
  "prediction": "attack",
  "attack_type": "NMAP_TCP_scan",
  "confidence": 0.974,
  "severity": "high"
}
```

The real request schema will contain the features required by the trained preprocessing pipeline.

---

## Real-Time Detection Modes

The application can support several data sources.

### Dataset Replay

Replays observations from RT-IoT2022 as a real-time stream.

This is the safest option for development and demonstration.

### Traffic Simulator

Generates simulated normal and malicious traffic scenarios.

### Live Packet Capture

Captures packets from a network interface using Scapy or PyShark.

Live capture may require administrator privileges.

```bash
sudo python simulator/live_capture.py
```

The first version of the project should use dataset replay before adding live packet capture.

---

## Testing

Run backend tests:

```bash
cd backend
pytest
```

Run frontend tests:

```bash
cd frontend
npm run test
```

Run code quality checks:

```bash
npm run lint
```

---

## Security and Limitations

This project is designed for educational and experimental purposes.

* It should not be used as the only security system in a production network.
* Model performance depends on the training dataset.
* Unknown attacks may not be detected correctly.
* Network environments can differ from the RT-IoT2022 environment.
* False positives and false negatives are possible.
* Live packet capture must only be used on networks where permission has been granted.

---

## Development Roadmap

### Phase 1 — Dataset and Models

* Explore the dataset
* Clean and preprocess the data
* Train baseline models
* Compare model performance
* Save the best model

### Phase 2 — Backend

* Build the FastAPI application
* Add prediction endpoints
* Add database storage
* Add alert management
* Add live event streaming

### Phase 3 — Frontend

* Build the dashboard layout
* Add model-analysis charts
* Add the alert investigation interface
* Add observation testing
* Add the network topology view

### Phase 4 — Real-Time System

* Add dataset replay
* Add the traffic simulator
* Add live packet capture
* Add real-time alerts

### Phase 5 — Testing and Deployment

* Add automated tests
* Add Docker support
* Measure performance
* Improve accessibility
* Write the final report

---

## Dataset

**RT-IoT2022**

UCI Machine Learning Repository:

```text
https://archive.ics.uci.edu/dataset/942/rt-iot2022
```

The dataset contains normal IoT network traffic and several cyberattack categories.

---

## Authors

**Zakaria Elkhaldi**

Computer Science Student
EMSI Casablanca

---

## License

This project is intended for academic and educational use.

A specific open-source license can be added before public distribution.

