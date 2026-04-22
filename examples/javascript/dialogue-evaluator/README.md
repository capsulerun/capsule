# Dialogue Evaluator

GitHub Repository: https://github.com/capsulerun/capsule

This example demonstrates how to build a multi-task workflow in that processes data, interacts with an external LLM, and manages file I/O.
We're creating many tiny agents that evaluate video game dialogue emotions and save them in a CSV.

https://github.com/user-attachments/assets/96b6c58a-a4c3-4e5d-91b2-5366849273de


## Setup

You need to install packages:
```bash
npm install -g @capsule-run/cli
npm install
```

And create a `.env` file in this directory by copying the example:
```bash
cp .env.example .env
```

Edit the `.env` file and add your API details:
```env
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1 # or your custom endpoint
OPENAI_MODEL=gpt-4o-mini # or your preferred model
```

## Running the Application

Execute the workflow using the Capsule CLI:
```bash
capsule run --verbose
```

Or run the specific entrypoint:
```bash
capsule run main.ts --verbose
```

## Detailed Workflow Logic

```mermaid
---
config:
  theme: mc
  themeVariables:
    fontSize: 16px
  look: neo
  layout: dagre
---
flowchart LR
 subgraph input["INPUT"]
        A["Main Task<br>---<br>Compute: HIGH"]
        B["Get Dialogue Lines<br>---<br>Compute: LOW"]
        C["Read JSON<br>source/dialogue-lines.json"]
  end
 subgraph loop["PROCESSING LOOP"]
        D{"For each<br>dialogue line"}
        E["Agent Task<br>---<br>Timeout: 1.8s<br>Retries: 1"]
  end
 subgraph evaluation["EVALUATION"]
        G["Evaluate Dialogue Line<br>---<br>Call OpenAI API"]
        H{"API<br>Response"}
  end
 subgraph output["OUTPUT"]
        I["Insert Dialogue Line<br>---<br>Append to CSV"]
        J["Write<br>output/evaluated-dialogue-lines.csv"]
  end
 subgraph control["CONTROL"]
        K{"More<br>lines?"}
        L["Report Statistics<br>---<br>Success / Failed counts"]
  end
    A --> B
    B --> C
    C --> D
    D -- Yes --> E
    G --> H
    H -- Success --> I
    I --> J
    J --> K
    H -. Timeout/Error .-> M["Failed"]
    M -.-> K
    K -- Yes --> D
    K -- No --> L
    L --> N["End"]


```

## Output

After running, check the results in `output/evaluated-dialogue-lines.csv`:
```csv
dialogue,emotion
"What's in the suitcase?",neutral
"You're out of your mind.",angry
"I'll buy it off you.",happy
```

