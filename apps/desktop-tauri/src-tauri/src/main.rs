fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Marlene desktop shell failed");
}
