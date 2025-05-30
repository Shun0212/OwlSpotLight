#!/usr/bin/env python3
"""
OwlSpotLight拡張機能のテスト用サンプルファイル
"""

class DataProcessor:
    """データ処理を行うクラス"""
    
    def __init__(self, data):
        self.data = data
    
    def clean_data(self):
        """データをクリーンアップする"""
        return [x for x in self.data if x is not None]
    
    def transform_data(self):
        """データを変換する"""
        return [str(x).upper() for x in self.data]
    
    def validate_data(self):
        """データを検証する"""
        return all(isinstance(x, (int, str)) for x in self.data)

class Calculator:
    """計算機クラス"""
    
    def add(self, a, b):
        """加算"""
        return a + b
    
    def subtract(self, a, b):
        """減算"""
        return a - b
    
    def multiply(self, a, b):
        """乗算"""
        return a * b
    
    def divide(self, a, b):
        """除算"""
        if b == 0:
            raise ValueError("Cannot divide by zero")
        return a / b

# 独立関数
def parse_config(file_path):
    """設定ファイルを解析する"""
    with open(file_path, 'r') as f:
        return f.read()

def format_output(data):
    """出力をフォーマットする"""
    return f"Result: {data}"

def validate_input(user_input):
    """ユーザー入力を検証する"""
    return user_input is not None and len(str(user_input)) > 0

def main():
    """メイン関数"""
    processor = DataProcessor([1, 2, None, 4, "test"])
    calc = Calculator()
    
    clean_data = processor.clean_data()
    result = calc.add(10, 20)
    
    print(format_output(result))

if __name__ == "__main__":
    main()
