setup_testcp () {
    if [ -d "$HOME/testcp" ]; then
        echo "Test cannot run if testcp already exists"
        exit 1
    fi

    mkdir ~/testcp
}


cleanup_testcp () {
    rm -rf "$HOME/testcp" || rmdir "$HOME/testcp"
}