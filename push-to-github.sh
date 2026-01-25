#!/bin/bash
# Push to GitHub using personal access token

set -e

if [ -z "$GITHUB_TOKEN" ]; then
    echo "Please set your GitHub token as an environment variable:"
    echo "  export GITHUB_TOKEN=your_token_here"
    echo "  ./push-to-github.sh"
    exit 1
fi

cd "$(dirname "$0")"

# Set remote URL with token
git remote set-url origin "https://${GITHUB_TOKEN}@github.com/devops-interact/gaussian_splat.git"

# Push to GitHub
echo "Pushing to GitHub..."
git push -u origin main

# Reset remote URL to remove token (for security)
git remote set-url origin "https://github.com/devops-interact/gaussian_splat.git"

echo ""
echo "✓ Successfully pushed to GitHub!"
echo ""
echo "Repository: https://github.com/devops-interact/gaussian_splat"
echo ""
echo "You can now import this repository in Vercel."
